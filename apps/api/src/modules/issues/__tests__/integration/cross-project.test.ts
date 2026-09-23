import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { createRole } from '#tests/helpers/roles';

// GET /issues lists the active issues of every project the caller may read, for the
// Home list. The caller's memberships are the access check: another user's project
// never shows, and neither does one whose role does not grant work_items read.

type Columns = { id: number; stateType: string }[];

async function createProject(client: Api, key: string, name: string): Promise<Columns> {
  await client.projects.post({ key, name });
  const view = await client.projects({ projectKey: key }).get();
  return view.data!.columns.map((c) => ({ id: c.id, stateType: c.stateType }));
}

function createIssue(
  client: Api,
  projectKey: string,
  columnId: number,
  patch: Record<string, unknown> = {},
) {
  return client.projects({ projectKey }).issues.post({ columnId, title: 'Task', ...patch });
}

function list(client: Api, query: Record<string, string | number> = {}) {
  return client.issues.get({ query });
}

// A day relative to today, 'YYYY-MM-DD'.
function dayFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const mkt = await createProject(asOwner, 'MKT', 'Marketing');
  const ops = await createProject(asOwner, 'OPS', 'Operations');
  return { owner, asOwner, mkt, ops };
}

const column = (columns: Columns, stateType: string) =>
  columns.find((c) => c.stateType === stateType)!.id;

describe('GET /issues', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lists the issues of every project the caller is in, with their names', async () => {
    const { owner, asOwner, mkt, ops } = await setup();
    const areaId = (
      await asOwner.projects({ projectKey: 'MKT' })['view-folders'].post({ name: 'Backend' })
    ).data!.id;
    const inMkt = (
      await createIssue(asOwner, 'MKT', column(mkt, 'started'), {
        title: 'Ship it',
        folderId: areaId,
        assigneeUserId: owner.userId,
        priority: 'high',
        dueDate: '2030-01-01',
      })
    ).data!;
    await createIssue(asOwner, 'OPS', ops[0].id, { title: 'Rotate keys' });

    const res = await list(asOwner);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    const item = res.data!.items.find((i) => i.id === inMkt.id);
    expect(item).toMatchObject({
      identifier: inMkt.identifier,
      title: 'Ship it',
      projectKey: 'MKT',
      projectName: 'Marketing',
      areaName: 'Backend',
      stateType: 'started',
      assignee: { userId: owner.userId },
      delegate: null,
      priority: 'high',
    });
    expect(new Date(item!.dueDate!).getTime()).toBe(new Date('2030-01-01').getTime());
    expect(typeof item!.stateName).toBe('string');
    expect(res.data!.items.find((i) => i.projectKey === 'OPS')?.areaName).toBeNull();
  });

  it("leaves out another user's projects and archived issues", async () => {
    const { asOwner, mkt } = await setup();
    const archived = (await createIssue(asOwner, 'MKT', mkt[0].id)).data!.id;
    await asOwner.issues({ issueId: archived }).archive.post();
    const other = authedApi((await signUpTestUser()).cookie);
    const otherColumns = await createProject(other, 'SEC', 'Secret');
    await createIssue(other, 'SEC', otherColumns[0].id);

    const res = await list(asOwner);
    expect(res.data!.total).toBe(0);
    const theirs = await list(other);
    expect(theirs.data!.items.map((i) => i.projectKey)).toEqual(['SEC']);
  });

  it('leaves out a project whose role does not grant reading work items', async () => {
    const { asOwner, mkt, ops } = await setup();
    await createIssue(asOwner, 'MKT', mkt[0].id);
    await createIssue(asOwner, 'OPS', ops[0].id);
    const role = await createRole(asOwner, 'OPS', { name: 'No work items', permissions: {} });
    const joiner = await signUpTestUser();
    const invite = await asOwner
      .projects({ projectKey: 'MKT' })
      .invites.post({ email: joiner.email, role: 'member' });
    const member = authedApi(joiner.cookie);
    await member.invites({ token: invite.data!.token }).accept.post();
    const added = await asOwner
      .projects({ projectKey: 'OPS' })
      .members.post({ userId: joiner.userId, role: 'member', roleId: role.data!.id });
    expect(added.status).toBe(204);

    const res = await list(member);
    expect(res.status).toBe(200);
    expect(res.data!.items.map((i) => i.projectKey)).toEqual(['MKT']);
  });

  it('filters by project', async () => {
    const { asOwner, mkt, ops } = await setup();
    await createIssue(asOwner, 'MKT', mkt[0].id);
    await createIssue(asOwner, 'OPS', ops[0].id);

    const res = await list(asOwner, { projectKey: 'OPS' });
    expect(res.data!.items.map((i) => i.projectKey)).toEqual(['OPS']);
  });

  it('filters open issues and one state type', async () => {
    const { asOwner, mkt } = await setup();
    const open = (await createIssue(asOwner, 'MKT', column(mkt, 'started'))).data!.id;
    const done = (await createIssue(asOwner, 'MKT', column(mkt, 'completed'))).data!.id;
    const dropped = (await createIssue(asOwner, 'MKT', column(mkt, 'canceled'))).data!.id;

    const openRes = await list(asOwner, { stateType: 'open' });
    expect(openRes.data!.items.map((i) => i.id)).toEqual([open]);
    const doneRes = await list(asOwner, { stateType: 'completed' });
    expect(doneRes.data!.items.map((i) => i.id)).toEqual([done]);
    const all = await list(asOwner);
    expect(all.data!.items.map((i) => i.id).sort()).toEqual([open, done, dropped].sort());
  });

  it('rejects an unknown state type with 400', async () => {
    const { asOwner } = await setup();
    const res = await list(asOwner, { stateType: 'someday' });
    expect(res.status).toBe(400);
  });

  it('filters by who holds the issue', async () => {
    const { owner, asOwner, mkt } = await setup();
    const agent = (
      await createAgent(asOwner, 'MKT', { name: 'Bot', username: 'bot', kind: 'external' })
    ).data!.agent;
    const mine = (await createIssue(asOwner, 'MKT', mkt[0].id, { assigneeUserId: owner.userId }))
      .data!.id;
    const delegated = (
      await createIssue(asOwner, 'MKT', mkt[0].id, {
        assigneeUserId: null,
        delegateUserId: agent.userId,
      })
    ).data!.id;
    const nobody = (await createIssue(asOwner, 'MKT', mkt[0].id, { assigneeUserId: null })).data!
      .id;

    expect((await list(asOwner, { assignee: 'me' })).data!.items.map((i) => i.id)).toEqual([mine]);
    const agents = await list(asOwner, { assignee: 'agents' });
    expect(agents.data!.items.map((i) => i.id)).toEqual([delegated]);
    expect(agents.data!.items[0].delegate).toMatchObject({ userId: agent.userId, name: 'Bot' });
    expect((await list(asOwner, { assignee: 'unassigned' })).data!.items.map((i) => i.id)).toEqual([
      nobody,
    ]);
    expect((await list(asOwner, { assignee: agent.userId })).data!.items.map((i) => i.id)).toEqual([
      delegated,
    ]);
  });

  it('filters overdue issues and the ones due within a week', async () => {
    const { asOwner, mkt } = await setup();
    const overdue = (await createIssue(asOwner, 'MKT', mkt[0].id, { dueDate: '2000-01-01' })).data!
      .id;
    const soon = (await createIssue(asOwner, 'MKT', mkt[0].id, { dueDate: dayFromToday(2) })).data!
      .id;
    await createIssue(asOwner, 'MKT', mkt[0].id, { dueDate: dayFromToday(30) });
    await createIssue(asOwner, 'MKT', mkt[0].id);

    expect((await list(asOwner, { due: 'overdue' })).data!.items.map((i) => i.id)).toEqual([
      overdue,
    ]);
    expect((await list(asOwner, { due: 'week' })).data!.items.map((i) => i.id)).toEqual([soon]);
  });

  it("counts the due filters from the reader's day when it is given", async () => {
    const { asOwner, mkt } = await setup();
    const due = (await createIssue(asOwner, 'MKT', mkt[0].id, { dueDate: '2030-01-10' })).data!.id;

    const late = await list(asOwner, { due: 'overdue', today: '2030-01-11' });
    expect(late.data!.items.map((i) => i.id)).toEqual([due]);
    const onTheDay = await list(asOwner, { due: 'overdue', today: '2030-01-10' });
    expect(onTheDay.data!.total).toBe(0);
    const soon = await list(asOwner, { due: 'week', today: '2030-01-03' });
    expect(soon.data!.items.map((i) => i.id)).toEqual([due]);
    const tooEarly = await list(asOwner, { due: 'week', today: '2030-01-02' });
    expect(tooEarly.data!.total).toBe(0);

    const invalid = await list(asOwner, { due: 'overdue', today: 'tomorrow' });
    expect(invalid.status).toBe(400);
  });

  it('searches the title and the identifier', async () => {
    const { asOwner, mkt, ops } = await setup();
    const docs = (await createIssue(asOwner, 'MKT', mkt[0].id, { title: 'Write the docs' })).data!;
    const other = (await createIssue(asOwner, 'OPS', ops[0].id, { title: 'Rotate keys' })).data!;

    expect((await list(asOwner, { q: 'DOCS' })).data!.items.map((i) => i.id)).toEqual([docs.id]);
    expect((await list(asOwner, { q: other.identifier })).data!.items.map((i) => i.id)).toEqual([
      other.id,
    ]);
    expect((await list(asOwner, { q: '100%' })).data!.total).toBe(0);
  });

  it('orders by due date, the undated last, then by the latest update', async () => {
    const { asOwner, mkt } = await setup();
    const undatedOld = (await createIssue(asOwner, 'MKT', mkt[0].id)).data!.id;
    const late = (await createIssue(asOwner, 'MKT', mkt[0].id, { dueDate: '2031-01-01' })).data!.id;
    const early = (await createIssue(asOwner, 'MKT', mkt[0].id, { dueDate: '2030-01-01' })).data!
      .id;
    const undatedNew = (await createIssue(asOwner, 'MKT', mkt[0].id)).data!.id;
    await asOwner.issues({ issueId: undatedNew }).patch({ title: 'Touched' });

    const res = await list(asOwner);
    expect(res.data!.items.map((i) => i.id)).toEqual([early, late, undatedNew, undatedOld]);
  });

  it('pages the list and counts every match', async () => {
    const { asOwner, mkt } = await setup();
    for (let i = 0; i < 3; i++) await createIssue(asOwner, 'MKT', mkt[0].id);

    const res = await list(asOwner, { page: 2, pageSize: 2 });
    expect(res.data).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(res.data!.items).toHaveLength(1);

    const tooLarge = await list(asOwner, { pageSize: 101 });
    expect(tooLarge.status).toBe(400);
  });
});
