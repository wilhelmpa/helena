import { beforeEach, describe, expect, it } from 'bun:test';
import { db } from '@repo/db';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent, teamOf } from '#tests/helpers/agents';
import { createRole } from '#tests/helpers/roles';
import { transferDepartingAssignee } from '../../responsibility';

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'RESP', name: 'Responsibility' });
  const view = (await api.projects({ projectKey: 'RESP' }).get()).data!;
  const columnId = view.columns.find((column) => column.stateType === 'unstarted')!.id;
  return { owner, api, columnId };
}

describe('responsible human on every issue', () => {
  beforeEach(resetDb);

  it('keeps responsibility valid when assignment races with project membership removal', async () => {
    const { owner, api, columnId } = await setup();
    const member = await signUpTestUser();
    const invite = (
      await api
        .projects({ projectKey: 'RESP' })
        .invites.post({ email: member.email, role: 'member' })
    ).data!;
    await authedApi(member.cookie).invites({ token: invite.token }).accept.post();
    const [created, removed] = await Promise.all([
      api
        .projects({ projectKey: 'RESP' })
        .issues.post({ columnId, title: 'Concurrent assignment', assigneeUserId: member.userId }),
      api.projects({ projectKey: 'RESP' }).members({ userId: member.userId }).delete(),
    ]);
    expect(removed.status).toBe(204);
    expect([201, 400]).toContain(created.status);
    if (created.data)
      expect((await api.issues({ issueId: created.data.id }).get()).data?.assigneeUserId).toBe(
        owner.userId,
      );
  });

  it('refuses assignment to a human whose project role cannot read tasks', async () => {
    const { owner, api, columnId } = await setup();
    const member = await signUpTestUser();
    const invite = (
      await api
        .projects({ projectKey: 'RESP' })
        .invites.post({ email: member.email, role: 'member' })
    ).data!;
    await authedApi(member.cookie).invites({ token: invite.token }).accept.post();
    const role = (await createRole(api, 'RESP', { name: 'No tasks', permissions: {} })).data!;
    await api
      .projects({ projectKey: 'RESP' })
      .members({ userId: member.userId })
      .patch({ role: 'member', roleId: role.id });
    const result = await api
      .projects({ projectKey: 'RESP' })
      .issues.post({ columnId, title: 'Unreadable', assigneeUserId: member.userId });
    expect(result.status).toBe(400);
    const automatic = await api
      .projects({ projectKey: 'RESP' })
      .issues.post({ columnId, title: 'Visible owner' });
    expect(automatic.data?.assigneeUserId).toBe(owner.userId);
    expect((await authedApi(member.cookie).issues.get()).data?.items).toEqual([]);
  });

  for (const removal of ['project', 'team', 'account'] as const) {
    it(`transfers open and archived tasks before removing a ${removal} member`, async () => {
      const { owner, api, columnId } = await setup();
      const responsible = await signUpTestUser();
      const invite = (
        await api
          .projects({ projectKey: 'RESP' })
          .invites.post({ email: responsible.email, role: 'member' })
      ).data!;
      await authedApi(responsible.cookie).invites({ token: invite.token }).accept.post();
      const tasks = [];
      for (const title of ['Open', 'Archived']) {
        const task = (
          await api
            .projects({ projectKey: 'RESP' })
            .issues.post({ columnId, title, assigneeUserId: responsible.userId })
        ).data!;
        tasks.push(task.id);
        if (title === 'Archived') await api.issues({ issueId: task.id }).archive.post();
      }
      const removed =
        removal === 'project'
          ? await api
              .projects({ projectKey: 'RESP' })
              .members({ userId: responsible.userId })
              .delete()
          : removal === 'team'
            ? await api
                .teams({ teamId: await teamOf(api, 'RESP') })
                .members({ userId: responsible.userId })
                .delete()
            : await api.god.users({ userId: responsible.userId }).delete();
      expect(removed.status).toBe(204);
      for (const issueId of tasks)
        expect((await api.issues({ issueId }).get()).data?.assigneeUserId).toBe(owner.userId);
    });
  }

  it('rolls back responsibility transfer when no remaining human owner exists', async () => {
    const { owner, api, columnId } = await setup();
    const task = (
      await api.projects({ projectKey: 'RESP' }).issues.post({ columnId, title: 'Keep owner' })
    ).data!;
    await expect(
      db.transaction((tx) => transferDepartingAssignee(tx, owner.userId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await api.issues({ issueId: task.id }).get()).data?.assigneeUserId).toBe(owner.userId);
  });

  it('defaults an omitted or null assignee to the human owner, including delegated tasks', async () => {
    const { owner, api, columnId } = await setup();
    const { agent } = (await createAgent(api, 'RESP', { name: 'Worker', username: 'worker' }))
      .data!;
    for (const assignment of [{}, { assigneeUserId: null }, { delegateUserId: agent.userId }]) {
      const result = await api
        .projects({ projectKey: 'RESP' })
        .issues.post({ columnId, title: 'Owned', ...assignment });
      expect(result.status).toBe(201);
      expect(result.data?.assigneeUserId).toBe(owner.userId);
    }
  });

  it('restores the owner when PATCH clears the responsible person and retains the delegate', async () => {
    const { owner, api, columnId } = await setup();
    const { agent } = (await createAgent(api, 'RESP', { name: 'Worker', username: 'worker' }))
      .data!;
    const task = (
      await api
        .projects({ projectKey: 'RESP' })
        .issues.post({ columnId, title: 'Owned', delegateUserId: agent.userId })
    ).data!;
    const result = await api.issues({ issueId: task.id }).patch({ assigneeUserId: null });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      assigneeUserId: owner.userId,
      delegateUserId: agent.userId,
    });
  });

  it('rejects an agent as responsible person on create and update', async () => {
    const { owner, api, columnId } = await setup();
    const { agent } = (await createAgent(api, 'RESP', { name: 'Worker', username: 'worker' }))
      .data!;
    expect(
      (
        await api
          .projects({ projectKey: 'RESP' })
          .issues.post({ columnId, title: 'Invalid', assigneeUserId: agent.userId })
      ).status,
    ).toBe(400);
    const task = (
      await api.projects({ projectKey: 'RESP' }).issues.post({ columnId, title: 'Owned' })
    ).data!;
    expect(
      (await api.issues({ issueId: task.id }).patch({ assigneeUserId: agent.userId })).status,
    ).toBe(400);
    expect((await api.issues({ issueId: task.id }).get()).data?.assigneeUserId).toBe(owner.userId);
  });

  it("inherits a parent's human assignee when an agent creates a subtask", async () => {
    const { api, columnId } = await setup();
    const responsible = await signUpTestUser();
    const invite = (
      await api
        .projects({ projectKey: 'RESP' })
        .invites.post({ email: responsible.email, role: 'member' })
    ).data!;
    await authedApi(responsible.cookie).invites({ token: invite.token }).accept.post();
    const parent = (
      await api
        .projects({ projectKey: 'RESP' })
        .issues.post({ columnId, title: 'Parent', assigneeUserId: responsible.userId })
    ).data!;
    const { agent, apiKey } = (
      await createAgent(api, 'RESP', { name: 'Worker', username: 'worker' })
    ).data!;
    const result = await apiKeyApi(apiKey)
      .projects({ projectKey: 'RESP' })
      .issues.post({ columnId, title: 'Child', parentId: parent.id, delegateUserId: agent.userId });
    expect(result.status).toBe(201);
    expect(result.data).toMatchObject({
      assigneeUserId: responsible.userId,
      parentId: parent.id,
      delegateUserId: agent.userId,
    });
    const cleared = await api.issues({ issueId: result.data!.id }).patch({ assigneeUserId: null });
    expect(cleared.data?.assigneeUserId).toBe(responsible.userId);
  });

  it("shows delegated work in the human owner's open list without exposing it to an outsider", async () => {
    const { owner, api, columnId } = await setup();
    const { agent } = (await createAgent(api, 'RESP', { name: 'Worker', username: 'worker' }))
      .data!;
    const task = (
      await api
        .projects({ projectKey: 'RESP' })
        .issues.post({ columnId, title: 'Delegated', delegateUserId: agent.userId })
    ).data!;
    const mine = await api.issues.get({ query: { assignee: 'me', stateType: 'open' } });
    expect(mine.data?.items).toContainEqual(
      expect.objectContaining({
        id: task.id,
        assignee: expect.objectContaining({ userId: owner.userId }),
        delegate: expect.objectContaining({ userId: agent.userId }),
      }),
    );
    const outsider = authedApi((await signUpTestUser()).cookie);
    expect((await outsider.issues.get({ query: { stateType: 'open' } })).data?.items).toEqual([]);
    expect(
      (await outsider.issues({ issueId: task.id }).patch({ assigneeUserId: null })).status,
    ).toBe(403);
  });
});
