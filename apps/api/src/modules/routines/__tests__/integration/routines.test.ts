import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { createServer } from 'node:http';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  agentRun,
  db,
  helenaDecisionEval,
  helenaSchedule,
  issue as issueTable,
  issueActivity,
  mailAccount,
  mailMessage,
  pipelineRun,
} from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { api, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { createAgent } from '#tests/helpers/agents';
import {
  finishAgentRun,
  resetEngineDb,
  startEngine,
  stopEngineRuns,
  stopTestEngine,
  waitForStatus,
} from '#tests/helpers/engine';
import { clearLimits, setLimits } from '#tests/helpers/limits';
import { addProjectMember } from '#tests/helpers/members';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { createRole } from '#tests/helpers/roles';
import {
  fireDueSchedules,
  latestFireTime,
  MISSED_GRACE_MS,
  planFire,
  recordScheduleRun,
} from '#modules/engine/schedules';
import { HEARTBEAT_PRECHECK_CLASS, LOCAL_DECISION_MODEL } from '#modules/decisions/classes';

// A run takes a few hops through the engine's queues (see helpers/engine.ts).
setDefaultTimeout(30_000);

// Routines on the Helena engine: Helena keeps them (helena_schedule) and the engine's
// tick fires them. Every fire creates a task delegated to the agent
// or reopens the routine's task, and skips a scheduled reopen while an agent run is active. Ported
// from the agent-routine workflow tests of the Mastra control plane and the routine
// dispatch tests of its bridge.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.projects({ projectKey: 'MKT' }).get()).data!;
  const agent = (
    await createAgent(asOwner, 'MKT', {
      name: 'Writer',
      username: 'writer',
      triggerOnAssign: true,
    } as never)
  ).data!.agent;
  const columns = view.columns;
  return {
    owner,
    asOwner,
    agent,
    teamId: created.data!.teamId,
    projectId: created.data!.id,
    columnId: columns[0]!.id,
    column: (name: string) => columns.find((column) => column.name === name)!.id,
  };
}

const routines = (client: Api, projectKey = 'MKT') => client.projects({ projectKey }).routines;

function routineBody(agentId: number, body: Record<string, unknown> = {}) {
  return {
    idempotencyKey: crypto.randomUUID(),
    agentId,
    title: 'Weekly report',
    instructions: 'Summarize the week.',
    mode: 'new' as const,
    cron: '0 9 * * 1',
    ...body,
  };
}

async function scheduleRow(id: string) {
  const [row] = await db.select().from(helenaSchedule).where(eq(helenaSchedule.id, id));
  return row!;
}

async function runsOf(scheduleId: string) {
  return db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.scheduleId, scheduleId))
    .orderBy(asc(pipelineRun.scheduledFor));
}

// Waits until the routine has `count` runs.
async function waitForRuns(scheduleId: string, count: number) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const runs = await runsOf(scheduleId);
    if (runs.length >= count) return runs;
    if (Date.now() > deadline) throw new Error(`Routine ${scheduleId} has ${runs.length} runs`);
    await Bun.sleep(100);
  }
}

// Fires the routine at a time, the way the engine's tick does, and waits for the run.
async function fire(scheduleId: string, at: Date, now = at.getTime()) {
  const runId = await planFire(scheduleId, at.toISOString(), now);
  if (runId) {
    const { startRun } = await import('#modules/engine/runs');
    await startRun(runId);
    return waitForStatus(runId, 'succeeded', 'skipped', 'failed');
  }
  return null;
}

beforeAll(async () => {
  await startEngine();
});

afterAll(async () => {
  await stopTestEngine();
});

beforeEach(async () => {
  await resetEngineDb();
});

afterEach(async () => {
  clearLimits();
  await stopEngineRuns();
});

describe('routines', () => {
  it('skips an unfinished prior task before starting a scheduled run and allows opt-out', async () => {
    const { asOwner, agent, columnId } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    expect(created.precheckEnabled).toBe(true);
    const task = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({
        columnId,
        title: 'Unfinished report',
      })
    ).data!;
    const prior = await recordScheduleRun(
      await scheduleRow(created.id),
      new Date(Date.now() - 86_400_000),
      'manual',
    );
    await db
      .update(pipelineRun)
      .set({ status: 'succeeded', issueId: task.id, finishedAt: new Date() })
      .where(eq(pipelineRun.id, prior.runId));
    const due = new Date();
    expect(await planFire(created.id, due.toISOString(), due.getTime())).toBeNull();
    const [skipped] = await db
      .select()
      .from(pipelineRun)
      .where(and(eq(pipelineRun.scheduleId, created.id), eq(pipelineRun.scheduledFor, due)));
    expect(skipped?.result).toEqual({ outcome: 'skipped', skipReason: 'no-work' });
    const runRoute = routines(asOwner)({ routineId: created.id }).runs;
    expect((await runRoute.get({ query: {} })).data?.total).toBe(1);
    expect((await runRoute.get({ query: { includeIdle: true } })).data?.total).toBe(2);
    const changed = await routines(asOwner)({ routineId: created.id }).patch({
      precheckEnabled: false,
    });
    expect(changed.data?.precheckEnabled).toBe(false);
    const next = new Date(due.getTime() + 60_000);
    expect(await planFire(created.id, next.toISOString(), next.getTime())).not.toBeNull();
  });

  it('uses the evaluated precheck class for one borderline scheduled task', async () => {
    const { asOwner, agent, teamId, columnId } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id, { gateSource: 'audit' })))
      .data!;
    const baseline = new Date(Date.now() - 60_000);
    const previous = await recordScheduleRun(await scheduleRow(created.id), baseline, 'schedule');
    await db
      .update(pipelineRun)
      .set({ status: 'succeeded', finishedAt: baseline })
      .where(eq(pipelineRun.id, previous.runId));
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({
      columnId,
      title: 'Optionale Aufgabe ohne Frist',
      priority: 'low',
    });

    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += chunk.toString();
      const body = JSON.parse(raw) as { messages: { content: string }[] };
      const user = JSON.parse(body.messages[1]!.content) as {
        options: { letter: string; option: string }[];
      };
      const top = user.options.map((entry) => ({
        token: entry.letter,
        prob: entry.option.startsWith('no:') ? 0.99 : 0.01,
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
      const credential = await asOwner.teams({ teamId }).credentials.post({
        kind: 'decision_model',
        label: 'Local Qwen test double',
        provider: 'local-logit',
        baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        model: LOCAL_DECISION_MODEL,
        allowPrivateAddress: true,
        value: 'codex72-test-key',
      });
      expect(credential.status).toBe(201);
      await db.insert(helenaDecisionEval).values({
        teamId,
        classId: HEARTBEAT_PRECHECK_CLASS,
        credentialId: credential.data!.id,
        backendLabel: 'test double',
        model: LOCAL_DECISION_MODEL,
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
      const enabled = await asOwner
        .teams({ teamId })
        .decisions.classes({ classId: HEARTBEAT_PRECHECK_CLASS })
        .patch({ credentialId: credential.data!.id, enabled: true });
      expect(enabled.status).toBe(200);

      const at = new Date();
      const runId = await planFire(created.id, at.toISOString(), at.getTime());
      expect(runId).not.toBeNull();
      const [run] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId!));
      expect(run.input).toMatchObject({
        gate: { source: 'audit', recommendation: 'skip', status: 'decided' },
      });
    } finally {
      server.close();
    }
  });

  it('records an empty audit in shadow mode and skips only after owner activation', async () => {
    const { asOwner, agent } = await setup();
    const created = (
      await routines(asOwner).post(
        routineBody(agent.id, {
          gateSource: 'audit',
        }),
      )
    ).data!;
    expect(created).toMatchObject({ gateMode: 'shadow', gateSource: 'audit' });
    const baseline = new Date(Date.now() - 60_000);
    const previous = await recordScheduleRun(await scheduleRow(created.id), baseline, 'schedule');
    await db
      .update(pipelineRun)
      .set({ status: 'succeeded', finishedAt: baseline })
      .where(eq(pipelineRun.id, previous.runId));

    const shadowAt = new Date();
    const shadowId = await planFire(created.id, shadowAt.toISOString(), shadowAt.getTime());
    expect(shadowId).not.toBeNull();
    const [shadow] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, shadowId!));
    expect(shadow).toMatchObject({
      status: 'pending',
      input: {
        gate: {
          mode: 'shadow',
          source: 'audit',
          recommendation: 'skip',
          counts: { open: 0, overdue: 0 },
        },
      },
    });
    const listed = (await routines(asOwner).get({ query: {} })).data!.items[0]!;
    expect(listed.lastRun?.gate).toMatchObject({ recommendation: 'skip', counts: { open: 0 } });

    const approved = await routines(asOwner)({ routineId: created.id }).patch({
      gateMode: 'active',
    });
    expect(approved.status).toBe(200);
    const activeAt = new Date(shadowAt.getTime() + 60_000);
    expect(await planFire(created.id, activeAt.toISOString(), activeAt.getTime())).toBeNull();
    const runs = await runsOf(created.id);
    expect(runs.at(-1)).toMatchObject({
      status: 'skipped',
      result: { outcome: 'skipped', skipReason: 'gate' },
    });
  });

  it('requires project-owner approval to activate a gate', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id, { gateSource: 'audit' })))
      .data!;
    const role = await createRole(asOwner, 'MKT', {
      name: 'Routine editor',
      permissions: { ai_agents: { read: true, create: true, edit: true, delete: false } },
    });
    const asMember = await addProjectMember(asOwner, 'MKT', role.data!.id);
    expect(
      (await routines(asMember)({ routineId: created.id }).patch({ gateMode: 'active' })).status,
    ).toBe(403);
    expect((await scheduleRow(created.id)).gateMode).toBe('shadow');
  });

  it('counts an overdue open ticket as audit work', async () => {
    const { asOwner, agent, columnId } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id, { gateSource: 'audit' })))
      .data!;
    const baseline = new Date(Date.now() - 60_000);
    const previous = await recordScheduleRun(await scheduleRow(created.id), baseline, 'schedule');
    await db
      .update(pipelineRun)
      .set({ status: 'succeeded', finishedAt: baseline })
      .where(eq(pipelineRun.id, previous.runId));
    await asOwner.projects({ projectKey: 'MKT' }).issues.post({
      columnId,
      title: 'Review overdue ticket',
      dueDate: '2020-01-01',
    });
    const at = new Date();
    const runId = await planFire(created.id, at.toISOString(), at.getTime());
    const [run] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId!));
    expect(run.input).toMatchObject({
      gate: { recommendation: 'run', counts: { open: 1, overdue: 1 } },
    });
  });

  it('counts new project mail and runs on a stale mailbox signal', async () => {
    const { asOwner, agent, teamId, projectId } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id, { gateSource: 'mail' })))
      .data!;
    const baseline = new Date(Date.now() - 60_000);
    const previous = await recordScheduleRun(await scheduleRow(created.id), baseline, 'schedule');
    await db
      .update(pipelineRun)
      .set({ status: 'succeeded', finishedAt: baseline })
      .where(eq(pipelineRun.id, previous.runId));
    const account = await insertMailAccount(teamId, projectId);
    await db
      .update(mailAccount)
      .set({ syncStatus: 'synced', lastSyncAt: new Date() })
      .where(eq(mailAccount.id, account.accountId));
    await insertMessage({
      teamId,
      accountId: account.accountId,
      folderId: account.inboxId,
      projectId,
      subject: 'Please reply',
    });
    const at = new Date();
    const runId = await planFire(created.id, at.toISOString(), at.getTime());
    expect(runId).not.toBeNull();
    const [run] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId!));
    expect(run.input).toMatchObject({
      gate: { recommendation: 'run', counts: { accounts: 1, newMail: 1, unread: 1 } },
    });

    await db.update(mailMessage).set({ deletedAt: new Date() });
    await db
      .update(mailAccount)
      .set({ lastSyncAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(mailAccount.id, account.accountId));
    const staleAt = new Date(at.getTime() + 60_000);
    const staleId = await planFire(created.id, staleAt.toISOString(), staleAt.getTime());
    const [stale] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, staleId!));
    expect(stale.input).toMatchObject({ gate: { recommendation: 'run', status: 'unavailable' } });
  });
  it('creates a routine in Europe/Berlin that fires from now on and replays its key', async () => {
    const { owner, asOwner, agent } = await setup();
    const body = routineBody(agent.id);
    const res = await routines(asOwner).post(body);
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      projectKey: 'MKT',
      projectName: 'Marketing',
      agent: { id: agent.id, name: 'Writer' },
      title: 'Weekly report',
      instructions: 'Summarize the week.',
      mode: 'new',
      task: null,
      cron: '0 9 * * 1',
      timezone: 'Europe/Berlin',
      catchUp: 'skip',
      enabled: true,
      lastRun: null,
    });
    // The next Monday at 09:00 in Berlin.
    const next = new Date(res.data!.nextRunAt!);
    expect(next.getUTCDay()).toBe(1);
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        minute: '2-digit',
      }).format(next),
    ).toBe('09:00');
    expect(await scheduleRow(res.data!.id)).toMatchObject({
      kind: 'routine',
      agentId: agent.id,
      actorUserId: owner.userId,
      enabled: true,
    });
    expect((await scheduleRow(res.data!.id)).firedThrough.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    const again = await routines(asOwner).post(body);
    expect(again.data?.id).toBe(res.data!.id);
    expect(await db.select().from(helenaSchedule)).toHaveLength(1);
  });

  it('reopens a task of the project and names it', async () => {
    const { asOwner, agent, columnId } = await setup();
    const task = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Backups' })
    ).data!;
    const res = await routines(asOwner).post(
      routineBody(agent.id, { mode: 'reopen', taskId: task.id, timezone: 'UTC', catchUp: 'once' }),
    );
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      mode: 'reopen',
      task: { id: task.id, number: task.sequenceNumber, title: 'Backups' },
      timezone: 'UTC',
      catchUp: 'once',
    });
  });

  it('validates the agent, the task, the cron, the time zone and the cadence', async () => {
    const { asOwner, agent } = await setup();
    const idle = (await createAgent(asOwner, 'MKT', { name: 'Idle', username: 'idle' } as never))
      .data!.agent;
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const foreign = (
      await asOwner.projects({ projectKey: 'OPS' }).issues.post({
        columnId: (await asOwner.projects({ projectKey: 'OPS' }).get()).data!.columns[0]!.id,
        title: 'Elsewhere',
      })
    ).data!;
    for (const body of [
      { agentId: agent.id + 1000 },
      { agentId: idle.id },
      { mode: 'reopen' },
      { mode: 'reopen', taskId: foreign.id },
      { cron: 'every day' },
      { cron: '0 9 L * *' },
      { timezone: 'Mars/Olympus' },
      { title: '   ' },
      { title: 'x'.repeat(301) },
      { catchUp: 'always' },
    ]) {
      expect((await routines(asOwner).post(routineBody(agent.id, body))).status).toBe(400);
    }
    setLimits({ minScheduleIntervalSeconds: 3600 });
    expect(
      (await routines(asOwner).post(routineBody(agent.id, { cron: '*/5 * * * *' }))).status,
    ).toBe(400);
    expect(
      (await routines(asOwner).post(routineBody(agent.id, { cron: '0 * * * *' }))).status,
    ).toBe(201);
    expect(await db.select().from(helenaSchedule)).toHaveLength(1);
  });

  it('refuses a routine for an agent that takes tasks from its owner only', async () => {
    const { asOwner, agent, teamId } = await setup();
    await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ runnerScope: 'owner' });
    const role = await createRole(asOwner, 'MKT', {
      name: 'Agent admin',
      permissions: { ai_agents: { read: true, create: true, edit: true, delete: true } },
    });
    const asMember = await addProjectMember(asOwner, 'MKT', role.data!.id);
    expect((await routines(asMember).post(routineBody(agent.id))).status).toBe(403);
    const mine = await routines(asOwner).post(routineBody(agent.id));
    expect(mine.status).toBe(201);
    expect((await routines(asMember)({ routineId: mine.data!.id }).run.post()).status).toBe(403);
  });

  it('changes a routine for the member who saves it and switches it off and on', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    const routine = routines(asOwner)({ routineId: created.id });
    const past = new Date('2026-01-01T00:00:00Z');
    const rewind = () =>
      db
        .update(helenaSchedule)
        .set({ firedThrough: past })
        .where(eq(helenaSchedule.id, created.id));
    // A new title leaves the schedule where it was; another time starts it afresh.
    await rewind();
    await routine.patch({ title: 'Monthly report' });
    expect((await scheduleRow(created.id)).firedThrough).toEqual(past);
    const changed = await routine.patch({ cron: '0 9 1 * *' });
    expect(changed.data).toMatchObject({ title: 'Monthly report', cron: '0 9 1 * *' });
    expect((await scheduleRow(created.id)).firedThrough.getTime()).toBeGreaterThan(past.getTime());
    const off = await routine.patch({ enabled: false });
    expect(off.data).toMatchObject({ enabled: false, nextRunAt: null });
    // Switched on again, it starts afresh as well: the times it was off do not fire.
    await rewind();
    const on = await routine.patch({ enabled: true, catchUp: 'once' });
    expect(on.data).toMatchObject({ enabled: true, catchUp: 'once' });
    expect((await scheduleRow(created.id)).firedThrough.getTime()).toBeGreaterThan(past.getTime());
  });

  it('lists the routines of a project and of every project the member reads', async () => {
    const { asOwner, agent } = await setup();
    const first = (await routines(asOwner).post(routineBody(agent.id))).data!;
    await asOwner.projects.post({ key: 'OPS', name: 'Operations' });
    const ops = (
      await createAgent(asOwner, 'OPS', {
        name: 'Operator',
        username: 'operator',
        triggerOnAssign: true,
      } as never)
    ).data!.agent;
    const second = (await routines(asOwner, 'OPS').post(routineBody(ops.id))).data!;
    expect((await routines(asOwner).get({ query: {} })).data).toMatchObject({
      total: 1,
      items: [{ id: first.id }],
    });
    const home = (await asOwner.routines.get({ query: {} })).data!;
    expect(home.items.map((item) => [item.projectKey, item.id])).toEqual([
      ['OPS', second.id],
      ['MKT', first.id],
    ]);
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await stranger.routines.get({ query: {} })).data).toMatchObject({ total: 0 });
    expect((await routines(stranger).get({ query: {} })).status).toBe(403);
    expect((await api.routines.get({ query: {} })).status).toBe(401);
  });

  it('runs now: creates a task delegated to the agent, skips while it is open, creates the next once it is done', async () => {
    const { asOwner, agent, column } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    const routine = routines(asOwner)({ routineId: created.id });
    const first = await routine.run.post();
    expect(first.status).toBe(202);
    const ran = await waitForStatus(first.data!.runId, 'succeeded');
    expect(ran.result).toMatchObject({ outcome: 'created', skipReason: null });
    const [task] = await db.select().from(issueTable).where(eq(issueTable.id, ran.issueId!));
    expect(task).toMatchObject({
      title: 'Weekly report',
      description: 'Summarize the week.',
      delegateUserId: agent.userId,
    });
    const runs = await db.select().from(agentRun).where(eq(agentRun.issueId, task!.id));
    expect(runs).toHaveLength(1);
    // The run is the routine's work for Lokale KI (class `routines`).
    expect(runs[0]!.workClass).toBe('routines');
    // The fire is on the event bus for the plugins: stored for the worker's delivery.
    const [fired] = await DBOS.listWorkflows({
      workflowIDs: [`worker-event:routine-fired:${ran.id}`],
      loadInput: true,
    });
    expect(fired).toMatchObject({ workflowName: 'helena.worker-event' });
    expect(fired!.input?.[0]).toMatchObject({
      type: 'helena.routine.fired',
      data: { routineId: created.id, fireId: ran.id, mode: 'new', agentId: agent.id },
    });

    const second = (await routine.run.post()).data!;
    const skipped = await waitForStatus(second.runId, 'skipped');
    expect(skipped).toMatchObject({
      issueId: task!.id,
      result: { outcome: 'skipped', skipReason: 'task-open' },
    });
    const listed = (await routines(asOwner).get({ query: {} })).data!.items[0]!;
    expect(listed.lastRun).toMatchObject({
      status: 'skipped',
      outcome: 'skipped',
      skipReason: 'task-open',
      taskNumber: task!.sequenceNumber,
    });

    await asOwner.issues({ issueId: task!.id }).patch({ columnId: column('Done') });
    const third = (await routine.run.post()).data!;
    const next = await waitForStatus(third.runId, 'succeeded');
    expect(next.issueId).not.toBe(task!.id);
    const history = (await routine.runs.get({ query: {} })).data!;
    expect(history.total).toBe(3);
    expect(history.items.map((item) => item.status)).toEqual(['succeeded', 'skipped', 'succeeded']);
  });

  it('reopens a finished task: back to unstarted, a comment and a new run of the agent', async () => {
    const { asOwner, agent, column } = await setup();
    const task = (
      await asOwner
        .projects({ projectKey: 'MKT' })
        .issues.post({ columnId: column('Done'), title: 'Backups' } as never)
    ).data!;
    const created = (
      await routines(asOwner).post(routineBody(agent.id, { mode: 'reopen', taskId: task.id }))
    ).data!;
    const run = (await routines(asOwner)({ routineId: created.id }).run.post()).data!;
    const reopened = await waitForStatus(run.runId, 'succeeded');
    expect(reopened.result).toMatchObject({ outcome: 'reopened', taskId: task.id });
    const [after] = await db.select().from(issueTable).where(eq(issueTable.id, task.id));
    expect(after).toMatchObject({ columnId: column('Todo'), delegateUserId: agent.userId });
    const comments = await db
      .select({ body: issueActivity.body })
      .from(issueActivity)
      .where(and(eq(issueActivity.issueId, task.id), eq(issueActivity.kind, 'comment')));
    expect(comments).toContainEqual({
      body: 'Reopened by the schedule "Weekly report".\n\nSummarize the week.',
    });
    const runs = await db.select().from(agentRun).where(eq(agentRun.issueId, task.id));
    expect(runs.map((run) => run.workClass)).toEqual(['routines']);
    // A manual fire uses the same task even while its agent run is pending.
    const again = (await routines(asOwner)({ routineId: created.id }).run.post()).data!;
    const repeated = await waitForStatus(again.runId, 'succeeded');
    expect(repeated.result).toMatchObject({ outcome: 'reopened', taskId: task.id });
    expect(await db.select().from(agentRun).where(eq(agentRun.issueId, task.id))).toHaveLength(1);
  });

  it('runs now on an initially open task without creating another task', async () => {
    const { asOwner, agent, columnId } = await setup();
    const task = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Backups' })
    ).data!;
    const created = (
      await routines(asOwner).post(routineBody(agent.id, { mode: 'reopen', taskId: task.id }))
    ).data!;
    const fire = (await routines(asOwner)({ routineId: created.id }).run.post()).data!;
    const run = await waitForStatus(fire.runId, 'succeeded');
    expect(run).toMatchObject({
      issueId: task.id,
      result: { outcome: 'reopened', skipReason: null, taskId: task.id },
    });
    expect(await db.select().from(issueTable)).toHaveLength(1);
    expect(await db.select().from(agentRun).where(eq(agentRun.issueId, task.id))).toHaveLength(1);
  });

  it('runs an open task on schedule unless an agent run is active and records the skip reason', async () => {
    const { asOwner, agent, columnId } = await setup();
    const task = (
      await asOwner.projects({ projectKey: 'MKT' }).issues.post({ columnId, title: 'Backups' })
    ).data!;
    const created = (
      await routines(asOwner).post(
        routineBody(agent.id, {
          mode: 'reopen',
          taskId: task.id,
          cron: '0 9 * * *',
          timezone: 'UTC',
          precheckEnabled: false,
        }),
      )
    ).data!;
    const monday = new Date('2026-09-21T09:00:00.000Z');
    const first = await fire(created.id, monday);
    expect(first).toMatchObject({
      status: 'succeeded',
      issueId: task.id,
      result: { outcome: 'reopened', skipReason: null },
    });
    const tuesday = new Date('2026-09-22T09:00:00.000Z');
    const skipped = await fire(created.id, tuesday);
    expect(skipped).toMatchObject({
      status: 'skipped',
      issueId: task.id,
      result: { outcome: 'skipped', skipReason: 'task-open' },
    });
    expect((await routines(asOwner).get({ query: {} })).data!.items[0]!.lastRun).toMatchObject({
      status: 'skipped',
      skipReason: 'task-open',
    });
    const history = (await routines(asOwner)({ routineId: created.id }).runs.get({ query: {} }))
      .data!;
    expect(history.items[0]).toMatchObject({
      status: 'skipped',
      result: { outcome: 'skipped', skipReason: 'task-open' },
    });
    const [pending] = await db.select().from(agentRun).where(eq(agentRun.issueId, task.id));
    await finishAgentRun(pending!.id, {});
    const wednesday = new Date('2026-09-23T09:00:00.000Z');
    const resumed = await fire(created.id, wednesday);
    expect(resumed).toMatchObject({
      status: 'succeeded',
      issueId: task.id,
      result: { outcome: 'reopened', skipReason: null },
    });
    expect(await db.select().from(issueTable)).toHaveLength(1);
    expect(await db.select().from(agentRun).where(eq(agentRun.issueId, task.id))).toHaveLength(2);
  });

  it('fires each time once, and records a fire that comes too late as missed', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id, { cron: '0 9 * * *' })))
      .data!;
    const monday = new Date('2026-09-21T07:00:00.000Z');
    const first = await fire(created.id, monday);
    expect(first).toMatchObject({ status: 'succeeded', trigger: 'schedule' });
    // The same time fired again (a replica, a backfill) runs nothing new.
    expect(await planFire(created.id, monday.toISOString(), monday.getTime())).toBeNull();
    // Ten minutes late is still on time; more is missed, and only the newest missed time
    // is recorded.
    const tuesday = new Date('2026-09-22T07:00:00.000Z');
    const wednesday = new Date('2026-09-23T07:00:00.000Z');
    const later = wednesday.getTime() + 60 * 60_000;
    expect(await planFire(created.id, tuesday.toISOString(), later)).toBeNull();
    expect(await planFire(created.id, wednesday.toISOString(), later)).toBeNull();
    const runs = await runsOf(created.id);
    expect(runs.map((run) => [run.scheduledFor!.toISOString(), run.status, run.result])).toEqual([
      [monday.toISOString(), 'succeeded', expect.objectContaining({ outcome: 'created' })],
      [wednesday.toISOString(), 'skipped', { outcome: 'skipped', skipReason: 'missed' }],
    ]);
  });

  it('runs the newest missed time once under the catch-up policy "once"', async () => {
    const { asOwner, agent } = await setup();
    const created = (
      await routines(asOwner).post(routineBody(agent.id, { cron: '0 9 * * *', catchUp: 'once' }))
    ).data!;
    const tuesday = new Date('2026-09-22T07:00:00.000Z');
    const wednesday = new Date('2026-09-23T07:00:00.000Z');
    const later = wednesday.getTime() + 5 * 60 * 60_000;
    expect(await planFire(created.id, tuesday.toISOString(), later)).toBeNull();
    const runId = await planFire(created.id, wednesday.toISOString(), later);
    expect(runId).not.toBeNull();
    const { startRun } = await import('#modules/engine/runs');
    await startRun(runId!);
    await waitForStatus(runId!, 'succeeded');
    expect((await runsOf(created.id)).map((run) => run.scheduledFor!.toISOString())).toEqual([
      wednesday.toISOString(),
    ]);
  });

  it('fires the time that has come from the engine tick once, across replicas and a clock set back', async () => {
    const { asOwner, agent } = await setup();
    const created = (
      await routines(asOwner).post(routineBody(agent.id, { cron: '0 9 * * *', catchUp: 'once' }))
    ).data!;
    // The routine was last fired two days ago.
    const now = new Date();
    const since = new Date(now.getTime() - 2 * 86_400_000);
    await db
      .update(helenaSchedule)
      .set({ firedThrough: since })
      .where(eq(helenaSchedule.id, created.id));
    const due = latestFireTime('0 9 * * *', 'Europe/Berlin', since, now)!;
    // Two replicas tick at the same moment, and one ticks again.
    await Promise.all([fireDueSchedules(now), fireDueSchedules(now)]);
    expect(await fireDueSchedules(now)).toBe(0);
    expect((await scheduleRow(created.id)).firedThrough).toEqual(due);
    const [run] = await waitForRuns(created.id, 1);
    await waitForStatus(run!.id, 'succeeded');
    // A clock set back an hour fires nothing again.
    expect(await fireDueSchedules(new Date(now.getTime() - 3_600_000))).toBe(0);
    const runs = await runsOf(created.id);
    expect(runs.map((item) => [item.scheduledFor!.toISOString(), item.trigger])).toEqual([
      [due.toISOString(), 'schedule'],
    ]);
  });

  it('records only the newest time missed during downtime, as missed under "skip"', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id, { cron: '0 * * * *' })))
      .data!;
    const now = new Date();
    const since = new Date(now.getTime() - 3 * 86_400_000);
    await db
      .update(helenaSchedule)
      .set({ firedThrough: since })
      .where(eq(helenaSchedule.id, created.id));
    expect(await fireDueSchedules(now)).toBe(1);
    const [run] = await waitForRuns(created.id, 1);
    const done = await waitForStatus(run!.id, 'succeeded', 'skipped');
    const due = latestFireTime('0 * * * *', 'Europe/Berlin', since, now)!;
    expect(done.scheduledFor).toEqual(due);
    // Less than ten minutes after the hour the time is still on time and runs.
    const late = now.getTime() - due.getTime() > MISSED_GRACE_MS;
    expect(done.status).toBe(late ? 'skipped' : 'succeeded');
    if (late) expect(done.result).toEqual({ outcome: 'skipped', skipReason: 'missed' });
    expect(await runsOf(created.id)).toHaveLength(1);
  });

  it('fires no run for a routine that is off, deleted or gone with its project', async () => {
    const { asOwner, agent } = await setup();
    const created = (await routines(asOwner).post(routineBody(agent.id))).data!;
    const at = new Date('2026-09-21T07:00:00.000Z');
    await routines(asOwner)({ routineId: created.id }).patch({ enabled: false });
    expect(await planFire(created.id, at.toISOString(), at.getTime())).toBeNull();
    expect((await routines(asOwner)({ routineId: created.id }).delete()).status).toBe(204);
    expect(await planFire(created.id, at.toISOString(), at.getTime())).toBeNull();
    for (const res of [
      await routines(asOwner)({ routineId: created.id }).delete(),
      await routines(asOwner)({ routineId: created.id }).run.post(),
      await routines(asOwner)({ routineId: 'nope' }).patch({ enabled: false }),
    ])
      expect(res.status).toBe(404);
  });

  it('keeps members without the agent permissions out', async () => {
    const { asOwner, agent } = await setup();
    const asMember = await addProjectMember(asOwner, 'MKT');
    expect((await routines(asMember).get({ query: {} })).status).toBe(200);
    expect((await routines(asMember).post(routineBody(agent.id))).status).toBe(403);
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect((await routines(stranger).post(routineBody(agent.id))).status).toBe(403);
  });
});
