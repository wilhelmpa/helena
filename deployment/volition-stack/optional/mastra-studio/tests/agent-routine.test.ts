import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import type { WorkEnvelope } from '../src/mastra/contracts.ts';
import type { PlanRoutineAdapter, RoutineRequest } from '../src/mastra/adapters/plan-routine.ts';
import type { AgentRoutineOutput, RoutineAnswer } from '../src/mastra/routine-contracts.ts';
import { buildAgentRoutineWorkflow, MISSED_FIRE_MS } from '../src/mastra/routine-workflow.ts';
import { fireEnvelope, runOutput } from '../src/mastra/scheduled-runs.ts';

function envelope(payload: Record<string, unknown> = {}, dryRun = false): WorkEnvelope {
  return {
    eventId: 'schedule-template',
    correlationId: 'schedule-template',
    occurredAt: '2026-09-23T00:00:00.000Z',
    source: 'itsaplan-schedule',
    actor: { type: 'human', id: 'user-1' },
    context: {
      organizationRef: 'organization:1',
      projectRef: 'project:DEMO',
      capabilityRefs: [],
      connectionRefs: [],
    },
    dryRun,
    payload: {
      projectRef: 'project:DEMO',
      agentRef: 'agent:writer',
      title: 'Weekly report',
      instructions: 'Summarize the week.',
      mode: 'new',
      ...payload,
    },
  };
}

// An adapter that records every request and answers with `answer`, which a test sets.
function recordingAdapter(answer: (request: RoutineRequest) => Omit<RoutineAnswer, 'idempotencyKey'>) {
  const requests: RoutineRequest[] = [];
  const adapter: PlanRoutineAdapter = {
    async dispatch(request) {
      requests.push(request);
      return { idempotencyKey: request.idempotencyKey, ...answer(request) };
    },
  };
  return { adapter, requests };
}

function instance(adapter: PlanRoutineAdapter, now?: () => number) {
  return new Mastra({
    workflows: { 'agent-routine': buildAgentRoutineWorkflow(adapter, now) },
    storage: new LibSQLStore({ id: 'agent-routine-test', url: process.env.STUDIO_DATABASE_URL! }),
  });
}

async function finished(mastra: Mastra, runId: string) {
  const workflow = mastra.getWorkflow('agent-routine');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await workflow.getWorkflowRunById(runId);
    if (run && ['success', 'failed'].includes(run.status)) {
      return { ...run, output: runOutput(run.result) as AgentRoutineOutput | undefined };
    }
    await sleep(25);
  }
  throw new Error(`Run ${runId} did not finish`);
}

// Fires the schedule once through Mastra's scheduler and waits for the run. Two fires in
// the same millisecond would share a run id, so each waits for the clock to move on.
async function fire(mastra: Mastra, scheduleId: string) {
  await sleep(2);
  const { claimId } = await mastra.schedules.run(scheduleId);
  return finished(mastra, claimId);
}

async function routineSchedule(mastra: Mastra, payload: Record<string, unknown> = {}) {
  await mastra.startWorkers();
  return mastra.schedules.create({
    workflowId: 'agent-routine',
    cron: '0 9 1 1 *',
    timezone: 'Europe/Berlin',
    inputData: envelope(payload),
    requestContext: { projectRef: 'project:DEMO' },
  });
}

test('a schedule fire takes its event id, correlation id and time from its run id', () => {
  const template = envelope();
  const fired = fireEnvelope(template, 'sched_schedule_abc_1790000000000');
  assert.equal(fired.eventId, 'sched_schedule_abc_1790000000000');
  assert.equal(fired.correlationId, 'sched_schedule_abc_1790000000000');
  assert.equal(fired.occurredAt, new Date(1790000000000).toISOString());
  assert.deepEqual(fireEnvelope(template, '123e4567-e89b-42d3-a456-426614174000'), template);
});

test('every fire of a schedule sends Plan its own idempotency key and is listed in the project', async () => {
  let task = 0;
  const { adapter, requests } = recordingAdapter(() => ({
    outcome: 'created',
    taskRef: `task:DEMO-${++task}`,
  }));
  const mastra = instance(adapter);
  const schedule = await routineSchedule(mastra, { mode: 'reopen', taskRef: 'task:DEMO-7' });
  try {
    const first = await fire(mastra, schedule.id);
    const second = await fire(mastra, schedule.id);
    assert.equal(first.status, 'success');
    assert.equal(second.status, 'success');
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey);
    assert.match(requests[0].idempotencyKey, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      { ...requests[0], idempotencyKey: undefined },
      {
        idempotencyKey: undefined,
        projectRef: 'project:DEMO',
        agentRef: 'agent:writer',
        title: 'Weekly report',
        instructions: 'Summarize the week.',
        mode: 'reopen',
        taskRef: 'task:DEMO-7',
        actorId: 'user-1',
      },
    );
    assert.equal(first.output?.correlationId, first.runId);
    const listed = await mastra
      .getWorkflow('agent-routine')
      .listWorkflowRuns({ resourceId: 'project:DEMO' });
    assert.deepEqual(
      listed.runs.map((run) => run.runId).sort(),
      [first.runId, second.runId].sort(),
    );
  } finally {
    await mastra.schedules.delete(schedule.id);
    await mastra.stopWorkers();
  }
});

test('a fire skips while the task the routine created last is still open', async () => {
  const open = new Set<string>();
  let task = 0;
  const { adapter, requests } = recordingAdapter((request) => {
    if (request.taskRef && open.has(request.taskRef)) {
      return { outcome: 'skipped', taskRef: request.taskRef };
    }
    const taskRef = `task:DEMO-${++task}`;
    open.add(taskRef);
    return { outcome: 'created', taskRef };
  });
  const mastra = instance(adapter);
  const schedule = await routineSchedule(mastra);
  try {
    const created = await fire(mastra, schedule.id);
    const skipped = await fire(mastra, schedule.id);
    const skippedAgain = await fire(mastra, schedule.id);
    open.clear();
    const next = await fire(mastra, schedule.id);

    assert.equal(requests[0].taskRef, undefined);
    assert.deepEqual(
      requests.slice(1).map((request) => request.taskRef),
      ['task:DEMO-1', 'task:DEMO-1', 'task:DEMO-1'],
    );
    assert.deepEqual(
      [created, skipped, skippedAgain, next].map((run) => [
        run.output?.status,
        run.output?.taskRef,
        run.output?.skipReason,
      ]),
      [
        ['created', 'task:DEMO-1', null],
        ['skipped', 'task:DEMO-1', 'task-open'],
        ['skipped', 'task:DEMO-1', 'task-open'],
        ['created', 'task:DEMO-2', null],
      ],
    );
  } finally {
    await mastra.schedules.delete(schedule.id);
    await mastra.stopWorkers();
  }
});

test('a fire that starts too late is skipped without asking Plan', async () => {
  const { adapter, requests } = recordingAdapter(() => ({
    outcome: 'created',
    taskRef: 'task:DEMO-1',
  }));
  const firedAt = Date.parse('2026-09-23T09:00:00.000Z');
  const late = instance(adapter, () => firedAt + MISSED_FIRE_MS + 1);
  const run = await late.getWorkflow('agent-routine').createRun({ runId: `sched_late_${firedAt}` });
  const result = await run.start({ inputData: envelope() });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.deepEqual(result.result, {
    workflowId: 'agent-routine',
    correlationId: `sched_late_${firedAt}`,
    projectRef: 'project:DEMO',
    status: 'skipped',
    taskRef: null,
    skipReason: 'missed',
  });
  assert.equal(requests.length, 0);

  const onTime = instance(adapter, () => firedAt + MISSED_FIRE_MS);
  const started = await onTime
    .getWorkflow('agent-routine')
    .createRun({ runId: `sched_on-time_${firedAt}` });
  assert.equal((await started.start({ inputData: envelope() })).status, 'success');
  assert.equal(requests.length, 1);
});

test('a dry run validates the routine without asking Plan', async () => {
  const { adapter, requests } = recordingAdapter(() => ({
    outcome: 'created',
    taskRef: 'task:DEMO-1',
  }));
  const run = await instance(adapter).getWorkflow('agent-routine').createRun();
  const result = await run.start({ inputData: envelope({}, true) });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.result.status, 'dry-run-complete');
  assert.equal(requests.length, 0);
});

test('rejects a routine outside its project and a reopen without its task', async () => {
  const { adapter, requests } = recordingAdapter(() => ({
    outcome: 'created',
    taskRef: 'task:DEMO-1',
  }));
  const workflow = instance(adapter).getWorkflow('agent-routine');
  for (const payload of [
    { projectRef: 'project:OTHER' },
    { mode: 'reopen' },
    { taskRef: 'task:DEMO-3' },
  ]) {
    const result = await (await workflow.createRun()).start({ inputData: envelope(payload) });
    assert.equal(result.status, 'failed', JSON.stringify(payload));
  }
  assert.equal(requests.length, 0);
});
