import { afterAll, beforeAll, beforeEach, expect, test, setDefaultTimeout } from 'bun:test';
import { agentRun, db, helenaDecisionClassSetting, pipelineRunStep } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { app, authedApi, client } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent, setAgentProjectRole } from '#tests/helpers/agents';
import { createRole } from '#tests/helpers/roles';
import { insertMailAccount } from '#tests/helpers/mail';
import {
  finishAgentRun,
  resetEngineDb,
  startEngine,
  stopTestEngine,
  waitForStatus,
} from '#tests/helpers/engine';
import { recordRoutineTriage, routineAttemptedMessages } from '#modules/mail-triage/routine';

setDefaultTimeout(30_000);
beforeAll(startEngine);
beforeEach(resetEngineDb);
afterAll(stopTestEngine);

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'TRIAGE', name: 'Triage' })).data!;
  const columns = (await api.projects({ projectKey: project.key }).get()).data!.columns;
  const created = (
    await createAgent(api, project.key, {
      name: 'Mail assistant',
      username: 'mail-assistant',
      triggerOnAssign: true,
      delegationDelaySec: 0,
    })
  ).data!;
  const role = (
    await createRole(api, project.key, {
      name: 'Mail triage',
      permissions: { mail: { read: true, edit: true } },
    })
  ).data!;
  await setAgentProjectRole(api, project.key, created.agent.userId, role.id);
  await insertMailAccount(project.teamId, project.id);
  await db.insert(helenaDecisionClassSetting).values({
    teamId: project.teamId,
    classId: 'helena.mail',
    enabled: true,
    updatedByUserId: owner.userId,
    config: { since: '2026-09-30T00:00:00Z' },
  });
  const task = (
    await api.projects({ projectKey: project.key }).issues.post({
      title: 'Kontrollaufgabe: Mail-Triage',
      columnId: columns.find((c) => c.stateType === 'completed')!.id,
    })
  ).data!;
  const routine = (
    await api.projects({ projectKey: project.key }).routines.post({
      idempotencyKey: crypto.randomUUID(),
      agentId: created.agent.id,
      title: 'Mail-Triage · fixture@example.test',
      instructions: 'Call run_mail_triage. Never send or delete mail.',
      mode: 'reopen',
      taskId: task.id,
      cron: '0 8,12,16,20 * * *',
    })
  ).data!;
  const fire = (
    await api.projects({ projectKey: project.key }).routines({ routineId: routine.id }).run.post({})
  ).data!;
  await waitForStatus(fire.runId, 'waiting');
  const runner = client(app, { headers: { 'x-api-key': created.apiKey! } });
  const claim = (await runner['agent-runs'].claim.post({})).data!.run!;
  const agentApi = client(app, {
    headers: { 'x-api-key': created.apiKey!, 'x-helena-run': String(claim.id) },
  });
  return {
    api,
    project,
    task,
    routine,
    fire,
    claim,
    agentApi,
    agentId: created.agent.id,
    agentUserId: created.agent.userId,
    done: columns.find((c) => c.stateType === 'completed')!.id,
  };
}

test('a drained successful triage closes its control task even if the runtime later fails', async () => {
  const s = await setup();
  const batch = await s.agentApi
    .projects({ projectKey: s.project.key })
    ['mail-triage'].run.post({});
  expect(batch.status).toBe(200);
  expect(batch.data).toMatchObject({ processed: 0, failed: 0, hasMore: false });
  expect((await s.api.issues({ issueId: s.task.id }).get()).data!.columnId).toBe(s.done);
  await finishAgentRun(s.claim.id, { status: 'failed', error: 'first-chunk' });
  expect((await waitForStatus(s.fire.runId, 'failed')).error).toContain('first-chunk');
  expect((await s.api.issues({ issueId: s.task.id }).get()).data!.columnId).toBe(s.done);
  const feed = (await s.api.issues({ issueId: s.task.id }).feed.get({ query: {} })).data!.items;
  expect(feed.some((item) => item.body?.includes('Blockiert'))).toBe(false);
});

test('a runtime success without a triage call cannot report a successful mail routine', async () => {
  const s = await setup();
  await finishAgentRun(s.claim.id, { output: 'Everything is fine.' });
  const fire = await waitForStatus(s.fire.runId, 'failed', 'succeeded');
  expect(fire.status).toBe('failed');
  expect(fire.error).toContain('triage');
  expect((await s.api.issues({ issueId: s.task.id }).get()).data!.columnId).toBe(s.done);
});

test('a forged run header cannot complete another agent control task', async () => {
  const s = await setup();
  const batch = await s.api.projects({ projectKey: s.project.key })['mail-triage'].run.post(
    {},
    {
      headers: { 'x-helena-run': String(s.claim.id) },
    },
  );
  expect(batch.status).toBe(200);
  expect((await s.api.issues({ issueId: s.task.id }).get()).data!.columnId).not.toBe(s.done);
  await db
    .update(agentRun)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(eq(agentRun.id, s.claim.id));
});

test('a failed batch remains a failure after a later empty batch and incidents deduplicate', async () => {
  const s = await setup();
  const empty = {
    accounts: [],
    processed: 0,
    receiptRetries: 0,
    receiptIds: [],
    receiptCount: 0,
    failed: 0,
    reviewRequired: 0,
    hasMore: false,
    results: [],
  };
  await recordRoutineTriage(s.project.id, s.agentUserId, String(s.claim.id), {
    ...empty,
    failed: 1,
  });
  await recordRoutineTriage(s.project.id, s.agentUserId, String(s.claim.id), empty);
  expect((await s.api.issues({ issueId: s.task.id }).get()).data!.columnId).not.toBe(s.done);
  await finishAgentRun(s.claim.id, { output: 'Done.' });
  expect((await waitForStatus(s.fire.runId, 'failed')).error).toContain('1 operations');
  const again = (
    await s.api
      .projects({ projectKey: s.project.key })
      .routines({ routineId: s.routine.id })
      .run.post({})
  ).data!;
  await waitForStatus(again.runId, 'waiting');
  const runs = (
    await s.api
      .teams({ teamId: s.project.teamId })
      ['ai-agents']({ agentId: s.agentId })
      .runs.get({ query: {} })
  ).data!.items;
  await finishAgentRun(runs[0]!.id, { status: 'failed', error: 'budget' });
  await waitForStatus(again.runId, 'failed');
  const tasks = (await s.api.projects({ projectKey: s.project.key }).issues.get({ query: {} }))
    .data!;
  expect(tasks.filter((task) => task.title === 'Mail triage: technical run failed')).toHaveLength(
    1,
  );
});

test('routine monitoring keeps the queued run even when its timestamp precedes dispatch', async () => {
  const s = await setup();
  const [step] = await db
    .select()
    .from(pipelineRunStep)
    .where(and(eq(pipelineRunStep.runId, s.fire.runId), eq(pipelineRunStep.stepId, 'dispatch')));
  expect(step!.agentRunId).toBe(s.claim.id);
  await db
    .update(agentRun)
    .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
    .where(eq(agentRun.id, s.claim.id));
  await finishAgentRun(s.claim.id, { status: 'failed', error: 'synthetic failure' });
  expect((await waitForStatus(s.fire.runId, 'failed')).error).toContain('synthetic failure');
});

test('deferred classification completes the routine and reports IDs and remaining mail', async () => {
  const s = await setup();
  await recordRoutineTriage(s.project.id, s.agentUserId, String(s.claim.id), {
    accounts: [],
    processed: 1,
    receiptRetries: 0,
    receiptIds: [],
    receiptCount: 0,
    failed: 0,
    reviewRequired: 0,
    hasMore: true,
    results: [
      {
        messageId: 7447,
        threadId: 7156,
        threadHref: '/project/TRIAGE/inbox?thread=7156',
        receiptIds: [],
        receiptCount: 0,
        status: 'retry',
        issueId: null,
        actionFailed: false,
        error: 'Mail classification generation budget exhausted',
      },
    ],
  });
  expect(await routineAttemptedMessages(s.project.id, s.agentUserId, String(s.claim.id))).toEqual([
    7447,
  ]);
  expect(await routineAttemptedMessages(s.project.id, 'another-user', String(s.claim.id))).toEqual(
    [],
  );
  await finishAgentRun(s.claim.id, { output: 'Deferred mail to the next scheduled run.' });
  expect((await waitForStatus(s.fire.runId, 'succeeded', 'failed')).status).toBe('succeeded');
  const comments = (await s.api.issues({ issueId: s.task.id }).feed.get()).data!;
  expect(
    comments.items.some(
      (c) => c.body?.includes('7447') && c.body.includes('Retry on next scheduled run'),
    ),
  ).toBe(true);
});
