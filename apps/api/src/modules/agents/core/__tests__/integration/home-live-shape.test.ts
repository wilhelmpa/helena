import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { aiAgent, db, project } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { bootstrapHomeAgent } from '../../../../../scripts/bootstrap-home-agent';

async function liveHomeFixture() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('Home agent was not provisioned');
  const [agent] = await db.select().from(aiAgent).where(eq(aiAgent.id, home.agentId));
  expect(agent).toMatchObject({ id: 1, teamId: 1, username: 'master', agentRole: 'home' });
  expect(await db.$count(project, eq(project.key, 'HOME'))).toBe(0);
  return { owner, asOwner, agent: agent!, asHome: apiKeyApi(home.apiKey) };
}

describe('live Home shape without a HOME project', () => {
  beforeEach(async () => {
    await resetDb();
    await rm(process.env.PROJECT_VAULT_ROOT!, { recursive: true, force: true });
    await mkdir(process.env.PROJECT_VAULT_ROOT!, { recursive: true });
  });

  it('lists projects and the Home agent tree without a technical project', async () => {
    const { asOwner, agent } = await liveHomeFixture();
    const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
    expect(created.status).toBe(201);
    const projects = await asOwner.projects.get();
    expect(projects.data?.map((item) => item.key)).toEqual(['MKT']);
    expect(projects.data?.[0]?.projectRole).toBe('project');
    const tree = await asOwner.teams({ teamId: agent.teamId }).organization.get();
    expect(tree.status).toBe(200);
    expect(tree.data?.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: agent.id, username: 'master' }),
        expect.objectContaining({ username: 'hermes-mkt-coordinator', reportsToAgentId: agent.id }),
      ]),
    );
    expect(await db.$count(project, eq(project.key, 'HOME'))).toBe(0);
  });

  it('serves my tasks, all open tasks, Start preferences and automation without Home project', async () => {
    const { owner, asOwner, agent } = await liveHomeFixture();
    await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
    const view = await asOwner.projects({ projectKey: 'MKT' }).get();
    const task = await asOwner.projects({ projectKey: 'MKT' }).issues.post({
      columnId: view.data!.columns[0]!.id,
      title: 'Live shape task',
      assigneeUserId: owner.userId,
    });
    expect(task.status).toBe(201);
    const mine = await asOwner.issues.get({ query: { assignee: 'me', stateType: 'open' } });
    const open = await asOwner.issues.get({ query: { stateType: 'open' } });
    expect(mine.data?.items.map((item) => item.id)).toContain(task.data!.id);
    expect(open.data?.items.map((item) => item.id)).toContain(task.data!.id);
    const dashboard = await asOwner.account.preferences.get();
    expect(dashboard.status).toBe(200);
    expect(dashboard.data?.homeDashboard).toBeDefined();
    const agents = await asOwner.teams({ teamId: agent.teamId })['ai-agents'].get();
    expect(agents.data?.find((item) => item.id === agent.id)?.projectScope).toBe('all');
    const coordinator = agents.data?.find((item) => item.username === 'hermes-mkt-coordinator');
    const schedule = await asOwner.projects({ projectKey: 'MKT' }).routines.post({
      idempotencyKey: crypto.randomUUID(),
      agentId: coordinator!.id,
      title: 'Weekly report',
      instructions: 'Summarize the week.',
      mode: 'new',
      cron: '0 9 * * 1',
    });
    expect(schedule.status).toBe(201);
    const routines = await asOwner.routines.get({ query: {} });
    expect(routines.status).toBe(200);
    expect(routines.data?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: schedule.data!.id })]),
    );
  });

  it('keeps Home, Private and Templates knowledge separate and exposes owner terminal', async () => {
    const { asOwner, asHome } = await liveHomeFixture();
    for (const notePath of ['Home/Docs/Overview.md', 'Private/Diary.md', 'Templates/Meeting.md']) {
      expect(
        (await asOwner.knowledge.notes.put({ path: notePath, content: '# Test' })).status,
      ).toBe(200);
      expect((await asOwner.knowledge.documents.get({ query: { path: notePath } })).status).toBe(
        200,
      );
    }
    const homeFolder = await asOwner.knowledge.folders.get({ query: { path: 'Home/Docs' } });
    expect(homeFolder.data?.items.map((item) => item.name)).toContain('Overview.md');
    const templatesFolder = await asOwner.knowledge.folders.get({ query: { path: 'Templates' } });
    expect(templatesFolder.data?.items.map((item) => item.name)).toContain('Meeting.md');
    expect(
      (await asHome.knowledge.documents.get({ query: { path: 'Home/Docs/Overview.md' } })).status,
    ).toBe(200);
    expect(
      (await asHome.knowledge.documents.get({ query: { path: 'Private/Diary.md' } })).status,
    ).toBe(403);
    const terminal = authedApi((await signUpTestUser({ name: 'Second owner check' })).cookie);
    expect((await asOwner['owner-terminal'].grant.get()).status).toBe(200);
    expect((await terminal['owner-terminal'].grant.get()).status).toBe(403);
  });

  it('leaves a second team master as a normal agent when Home already exists', async () => {
    const { agent } = await liveHomeFixture();
    const second = await signUpTestUser({ name: 'Second team' });
    const asSecond = authedApi(second.cookie);
    const secondProject = await asSecond.projects.post({ key: 'OPS', name: 'Operations' });
    const [duplicate] = await db
      .insert(aiAgent)
      .values({
        teamId: secondProject.data!.teamId,
        userId: second.userId,
        username: 'master',
        kind: 'external',
      })
      .returning();
    expect(duplicate).toMatchObject({ agentRole: 'agent', projectScope: 'selected' });
    expect(await db.$count(aiAgent, eq(aiAgent.agentRole, 'home'))).toBe(1);
    expect((await db.select().from(aiAgent).where(eq(aiAgent.id, agent.id)))[0]?.agentRole).toBe(
      'home',
    );
  });
});
