import { beforeEach, describe, expect, it } from 'bun:test';
import { agentHeartbeatEvent, agentRun, aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { fireDueAgentHeartbeats } from '../../heartbeats';

const now = new Date('2026-09-28T12:00:00.000Z');

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'MKT', name: 'Marketing' });
  const project = (await api.projects({ projectKey: 'MKT' }).get()).data!;
  const agent = (
    await createAgent(api, 'MKT', {
      name: 'Worker',
      username: 'worker',
      heartbeatIntervalMinutes: 60,
      heartbeatDays: [0, 1, 2, 3, 4, 5, 6],
      heartbeatStart: '00:00',
      heartbeatEnd: '23:59',
      heartbeatInstructions: 'Check the next task.',
    })
  ).data!.agent;
  await db.update(aiAgent).set({ heartbeatNextAt: now }).where(eq(aiAgent.id, agent.id));
  return { api, project, agent };
}

describe('agent heartbeats', () => {
  beforeEach(resetDb);

  it('records an idle check without a model run', async () => {
    const { api, agent } = await setup();
    expect(await fireDueAgentHeartbeats(now)).toBe(1);
    expect(await db.select().from(agentRun)).toHaveLength(0);
    expect(await db.select().from(agentHeartbeatEvent)).toMatchObject([
      { outcome: 'skipped', reason: 'no work' },
    ]);
    const history = await api
      .teams({ teamId: agent.teamId })
      ['ai-agents']({ agentId: agent.id })
      .heartbeats.get();
    expect(history.status).toBe(200);
    expect(history.data?.[0]?.reason).toBe('no work');
    expect(await fireDueAgentHeartbeats(now)).toBe(0);
  });

  it('queues one runtime-neutral run for assigned work and keeps its instruction', async () => {
    const { api, project, agent } = await setup();
    const issue = (
      await api
        .projects({ projectKey: 'MKT' })
        .issues.post({ columnId: project.columns[0].id, title: 'Fix report' })
    ).data!;
    await api.issues({ issueId: issue.id }).patch({ delegateUserId: agent.userId });
    await Promise.all([fireDueAgentHeartbeats(now), fireDueAgentHeartbeats(now)]);
    const runs = await db.select().from(agentRun);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: 'heartbeat', issueId: issue.id, status: 'pending' });
    expect(runs[0].prompt).toContain('Check the next task.');
    expect(await db.select().from(agentHeartbeatEvent)).toHaveLength(1);
  });

  it('rejects an invalid work window', async () => {
    const { api, agent } = await setup();
    const changed = await api
      .teams({ teamId: agent.teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ heartbeatStart: '18:00', heartbeatEnd: '09:00' });
    expect(changed.status).toBe(400);
  });

  it('does not start a run after its work window has closed', async () => {
    const { api, project, agent } = await setup();
    const issue = (
      await api.projects({ projectKey: 'MKT' }).issues.post({
        columnId: project.columns[0].id,
        title: 'Wait until morning',
      })
    ).data!;
    await api.issues({ issueId: issue.id }).patch({ delegateUserId: agent.userId });
    await db
      .update(aiAgent)
      .set({
        heartbeatTimezone: 'Europe/Berlin',
        heartbeatStart: '09:00',
        heartbeatEnd: '10:00',
        heartbeatNextAt: now,
      })
      .where(eq(aiAgent.id, agent.id));
    expect(await fireDueAgentHeartbeats(now)).toBe(1);
    expect(await db.select().from(agentRun)).toHaveLength(0);
    expect(await db.select().from(agentHeartbeatEvent)).toMatchObject([
      { outcome: 'skipped', reason: 'outside work hours' },
    ]);
  });

  it('wakes for a due project goal without an assigned issue', async () => {
    const { api, agent } = await setup();
    const goal = await api.teams({ teamId: agent.teamId }).organization.goals.post({
      title: 'Publish report',
      status: 'active',
      projectId: agent.projects[0].id,
      targetDate: '2026-09-28',
    });
    expect(goal.status).toBe(201);
    expect(await fireDueAgentHeartbeats(now)).toBe(1);
    expect(await db.select().from(agentHeartbeatEvent)).toMatchObject([{ reason: 'due goal' }]);
    const runs = await db.select().from(agentRun);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: 'heartbeat', issueId: null });
    expect(runs[0].prompt).toContain('Publish report');
  });

  it('notices a new comment on delegated work', async () => {
    const { api, project, agent } = await setup();
    const issue = (
      await api.projects({ projectKey: 'MKT' }).issues.post({
        columnId: project.columns[0].id,
        title: 'Review copy',
      })
    ).data!;
    await api.issues({ issueId: issue.id }).patch({ delegateUserId: agent.userId });
    await api.issues({ issueId: issue.id }).comments.post({ body: 'New feedback' });
    await db
      .update(aiAgent)
      .set({ heartbeatLastAt: new Date('2026-09-27T00:00:00Z') })
      .where(eq(aiAgent.id, agent.id));
    await fireDueAgentHeartbeats(now);
    expect(await db.select().from(agentHeartbeatEvent)).toMatchObject([{ reason: 'new comment' }]);
  });
});
