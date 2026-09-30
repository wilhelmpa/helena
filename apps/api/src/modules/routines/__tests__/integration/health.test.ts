import { beforeEach, expect, it } from 'bun:test';
import { db, aiAgent, agentRun } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

beforeEach(resetDb);

it('reports unresolved failures and offline agents only in the accessible project', async () => {
  const owner = authedApi((await signUpTestUser()).cookie);
  const project = (await owner.projects.post({ key: 'OPS', name: 'Operations' })).data!;
  const view = (await owner.projects({ projectKey: 'OPS' }).get()).data!;
  const agent = (await createAgent(owner, 'OPS', { name: 'Checker', username: 'checker' } as never))
    .data!.agent;
  await db
    .update(aiAgent)
    .set({ lastSeenAt: new Date(Date.now() - 3600000) })
    .where(eq(aiAgent.id, agent.id));
  const task = (
    await owner.projects({ projectKey: 'OPS' }).issues.post({
      columnId: view.columns[0]!.id,
      title: 'Investigation',
    })
  ).data!;
  const [run] = await db
    .insert(agentRun)
    .values({
      agentId: agent.id,
      projectId: project.id,
      issueId: task.id,
      prompt: 'A private prompt',
      output: 'A private transcript',
      status: 'failed',
      lastError: 'Private runtime detail',
      finishedAt: new Date(),
    })
    .returning();
  const result = await owner.projects({ projectKey: 'OPS' })['automation-health'].get();
  expect(result.status).toBe(200);
  expect(result.data!.runs.map((item) => item.id)).toEqual([run!.id]);
  expect(result.data!.offlineAgents.map((item) => item.id)).toContain(agent.id);
  expect(JSON.stringify(result.data)).not.toContain('Private');
  expect(JSON.stringify(result.data)).not.toContain('private');
  await db.update(agentRun).set({ archivedAt: new Date() }).where(eq(agentRun.id, run!.id));
  const archived = await owner.projects({ projectKey: 'OPS' })['automation-health'].get();
  expect(archived.data!.runs).toEqual([]);
  await db.update(agentRun).set({ archivedAt: null }).where(eq(agentRun.id, run!.id));
  await db.insert(agentRun).values({
    agentId: agent.id,
    projectId: project.id,
    issueId: task.id,
    prompt: 'Retry',
    status: 'success',
    finishedAt: new Date(),
  });
  await db.update(aiAgent).set({ pausedAt: new Date() }).where(eq(aiAgent.id, agent.id));
  const recovered = await owner.projects({ projectKey: 'OPS' })['automation-health'].get();
  expect(recovered.data).toMatchObject({ runs: [], offlineAgents: [], truncated: false });
  const outsider = authedApi((await signUpTestUser()).cookie);
  expect((await outsider.projects({ projectKey: 'OPS' })['automation-health'].get()).status).toBe(
    403,
  );
});
