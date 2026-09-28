import { beforeEach, describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import {
  agentHeartbeatEvent,
  agentRun,
  aiAgent,
  db,
  helenaDecision,
  helenaDecisionEval,
  helenaBudget,
  organizationDepartment,
  organizationProjectAssignment,
  projectColumn,
} from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { fireDueAgentHeartbeats } from '../../heartbeats';
import { HEARTBEAT_PRECHECK_CLASS, LOCAL_DECISION_MODEL } from '#modules/decisions/classes';
import { recordUsage } from '#modules/agents/usage/service';

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
    expect(history.data).toEqual([]);
    const withIdle = await api
      .teams({ teamId: agent.teamId })
      ['ai-agents']({ agentId: agent.id })
      .heartbeats.get({ query: { includeIdle: true } });
    expect(withIdle.data?.[0]?.reason).toBe('no work');
    expect(await fireDueAgentHeartbeats(now)).toBe(0);
  });

  it('doubles the next heartbeat interval after 80 percent of an agent budget', async () => {
    const { api, agent } = await setup();
    const saved = await api
      .teams({ teamId: agent.teamId })
      ['ai-agents']({ agentId: agent.id })
      .autopilot.budgets.put({ budgets: [{ metric: 'tokens', period: 'day', limit: 100 }] });
    expect(saved.status).toBe(200);
    await recordUsage({
      agentId: agent.id,
      projectId: agent.projects[0]!.id,
      kind: 'run',
      spend: { model: 'test-model', inputTokens: 85, outputTokens: 0 },
    });
    await fireDueAgentHeartbeats(now);
    const [after] = await db
      .select({ next: aiAgent.heartbeatNextAt })
      .from(aiAgent)
      .where(eq(aiAgent.id, agent.id));
    expect(after!.next?.toISOString()).toBe('2026-09-28T14:00:00.000Z');
  });

  it('slows an assigned task heartbeat for a department budget', async () => {
    const { api, project, agent } = await setup();
    const [department] = await db
      .insert(organizationDepartment)
      .values({
        teamId: agent.teamId,
        name: 'Growth',
      })
      .returning();
    await db.insert(organizationProjectAssignment).values({
      teamId: agent.teamId,
      projectId: project.project.id,
      departmentId: department!.id,
    });
    await db.insert(helenaBudget).values({
      teamId: agent.teamId,
      departmentId: department!.id,
      metric: 'tokens',
      period: 'day',
      limitValue: 100,
    });
    const task = (
      await api.projects({ projectKey: 'MKT' }).issues.post({
        columnId: project.columns[0]!.id,
        title: 'Prepare launch',
      })
    ).data!;
    await api.issues({ issueId: task.id }).patch({ delegateUserId: agent.userId });
    await recordUsage({
      agentId: agent.id,
      projectId: project.project.id,
      kind: 'run',
      spend: { model: 'test-model', inputTokens: 85, outputTokens: 0 },
    });
    await fireDueAgentHeartbeats(now);
    const [after] = await db
      .select({ next: aiAgent.heartbeatNextAt })
      .from(aiAgent)
      .where(eq(aiAgent.id, agent.id));
    expect(after!.next?.toISOString()).toBe('2026-09-28T14:00:00.000Z');
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

  it('records an evaluated local no and skips one low backlog task', async () => {
    const { api, project, agent } = await setup();
    const issue = (
      await api.projects({ projectKey: 'MKT' }).issues.post({
        columnId: project.columns[0].id,
        title: 'Optionales Aufräumen bei Gelegenheit',
        priority: 'low',
      })
    ).data!;
    await api.issues({ issueId: issue.id }).patch({ delegateUserId: agent.userId });
    await db
      .update(projectColumn)
      .set({ stateType: 'backlog' })
      .where(eq(projectColumn.id, project.columns[0].id));

    let noProbability = 0.99;
    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk.toString();
      const body = JSON.parse(raw) as { messages: { content: string }[] };
      const user = JSON.parse(body.messages[1]!.content) as {
        options: { letter: string; option: string }[];
      };
      const top = user.options.map((entry) => ({
        token: entry.letter,
        prob: entry.option.startsWith('no:') ? noProbability : 1 - noProbability,
      }));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          model: LOCAL_DECISION_MODEL,
          choices: [{ logprobs: { content: [{ token: top[0]!.token, top_probs: top }] } }],
          usage: { prompt_tokens: 20, completion_tokens: 1 },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const credential = await api.teams({ teamId: agent.teamId }).credentials.post({
        kind: 'decision_model',
        label: 'Local Qwen test double',
        provider: 'local-logit',
        baseUrl: `http://127.0.0.1:${port}`,
        model: LOCAL_DECISION_MODEL,
        allowPrivateAddress: true,
        value: 'codex72-test-key',
      });
      expect(credential.status).toBe(201);
      await db.insert(helenaDecisionEval).values({
        teamId: agent.teamId,
        classId: HEARTBEAT_PRECHECK_CLASS,
        credentialId: credential.data!.id,
        backendLabel: 'test double',
        threshold: 0.8,
        questions: 60,
        answered: 60,
        correct: 60,
        correctAnswered: 60,
        precision: 1,
        coverage: 1,
        accuracy: 1,
        passed: true,
        finishedAt: new Date(),
      });
      const enabled = await api
        .teams({ teamId: agent.teamId })
        .decisions.classes({ classId: HEARTBEAT_PRECHECK_CLASS })
        .patch({ credentialId: credential.data!.id, enabled: true });
      expect(enabled.status).toBe(200);
      expect(await fireDueAgentHeartbeats(now)).toBe(1);
      expect(await db.select().from(agentRun)).toHaveLength(1);
      expect((await db.select().from(agentHeartbeatEvent))[0]?.reason).toContain(
        'precheck decided: no',
      );
      expect((await db.select().from(agentHeartbeatEvent))[0]?.reason).toContain('[shadow]');
      expect(await db.select().from(helenaDecision)).toMatchObject([
        { classId: HEARTBEAT_PRECHECK_CLASS },
      ]);

      await db.delete(agentRun);
      await db
        .update(helenaDecision)
        .set({ createdAt: new Date(now.getTime() - 8 * 24 * 60 * 60_000) })
        .where(eq(helenaDecision.classId, HEARTBEAT_PRECHECK_CLASS));
      await api
        .teams({ teamId: agent.teamId })
        .decisions.classes({ classId: HEARTBEAT_PRECHECK_CLASS })
        .patch({ config: { heartbeatMode: 'active' } });
      await db.update(aiAgent).set({ heartbeatNextAt: now }).where(eq(aiAgent.id, agent.id));
      expect(await fireDueAgentHeartbeats(now)).toBe(1);
      expect(await db.select().from(agentRun)).toHaveLength(0);
      expect(
        (await db.select().from(agentHeartbeatEvent)).some(
          (event) => event.reason.includes('precheck decided: no') && event.outcome === 'skipped',
        ),
      ).toBe(true);

      // The same low-priority task must run when the model cannot decide confidently.
      noProbability = 0.55;
      await db.update(aiAgent).set({ heartbeatNextAt: now }).where(eq(aiAgent.id, agent.id));
      expect(await fireDueAgentHeartbeats(now)).toBe(1);
      expect(await db.select().from(agentRun)).toHaveLength(1);
      expect(
        (await db.select().from(agentHeartbeatEvent)).some((event) =>
          event.reason.includes('precheck unsure: no'),
        ),
      ).toBe(true);
    } finally {
      server.close();
    }
  });
});
