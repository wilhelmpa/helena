import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import type { WorkEnvelope } from '../src/mastra/contracts.ts';
import type {
  AgentRequest,
  PipelineOperation,
  PlanPipelineAdapter,
} from '../src/mastra/adapters/plan-pipeline.ts';
import type { AgentResult, PipelineStep } from '../src/mastra/pipeline-contracts.ts';
import {
  branchStart,
  buildPipelineWorkflow,
  handlesOutcome,
  stepAfter,
} from '../src/mastra/pipeline-workflow.ts';
import { restartActiveRuns } from '../src/mastra/index.ts';

// plan-pipeline against a stand-in for Plan's pipeline control API: it answers every
// operation, records what Mastra asked, and lets a test decide conditions and the
// outcome of agent runs.

const agent = (id: string): PipelineStep => ({ id, name: `Agent ${id}`, type: 'agent' });
const action = (id: string): PipelineStep => ({ id, name: `Action ${id}`, type: 'action' });
const outcome = (id: string, then: PipelineStep[], otherwise: PipelineStep[] = []): PipelineStep => ({
  id,
  name: `Outcome ${id}`,
  type: 'condition',
  condition: { kind: 'outcome' },
  then,
  else: otherwise,
});
const approval = (id: string, onReject: PipelineStep['onReject'] = { action: 'end' }): PipelineStep => ({
  id,
  name: `Approval ${id}`,
  type: 'approval',
  onReject,
});

interface Call {
  operation: PipelineOperation;
  body: Record<string, unknown>;
}

function fakePlan(
  steps: PipelineStep[],
  options: {
    dryRun?: boolean;
    conditions?: Record<string, boolean[]>;
    agent?: (request: AgentRequest, signal?: AbortSignal) => Promise<AgentResult>;
    wakeAt?: string | null;
  } = {},
) {
  const calls: Call[] = [];
  const agentRuns: AgentRequest[] = [];
  const adapter: PlanPipelineAdapter = {
    async control(operation, body) {
      calls.push({ operation, body });
      switch (operation) {
        case 'begin':
          return {
            run: {
              id: body.runId,
              pipelineId: 1,
              pipelineName: 'Release',
              version: 3,
              taskRef: 'task:DEMO-1',
              dryRun: options.dryRun ?? false,
            },
            definition: { schemaVersion: 1, trigger: { type: 'manual' }, roles: [], steps },
          };
        case 'agent':
          return {
            dryRun: options.dryRun ?? false,
            attempt: 1,
            idempotencyKey: createHash('sha256')
              .update(`${body.runId}:${body.stepId}:${body.iteration}`)
              .digest('hex'),
            agentRef: 'agent:coder',
            taskRef: 'task:DEMO-1',
            prompt: `Do ${String(body.stepId)}`,
            timeoutSeconds: 600,
            policy: { maxTurns: 20 },
          };
        case 'condition':
          return { matched: options.conditions?.[String(body.stepId)]?.shift() ?? true };
        case 'action':
          return { summary: 'done' };
        case 'wait':
          return { wakeAt: options.wakeAt ?? null };
        case 'approval':
          return body.phase === 'wait' ? { message: 'Approve the release?' } : {};
        default:
          return {};
      }
    },
    async runAgent(request, signal) {
      agentRuns.push(request);
      return options.agent
        ? options.agent(request, signal)
        : { agentRunId: agentRuns.length, outcome: 'success', summary: `${request.prompt} done` };
    },
  };
  const executed = () =>
    calls
      .filter((call) => ['agent', 'condition', 'action', 'wait'].includes(call.operation) ||
        (call.operation === 'approval' && call.body.phase === 'wait'))
      .map((call) => `${call.body.stepId}#${call.body.iteration}`);
  return { adapter, calls, agentRuns, executed };
}

function envelope(dryRun = false): WorkEnvelope {
  const eventId = randomUUID();
  return {
    eventId,
    correlationId: eventId,
    occurredAt: '2026-09-23T00:00:00.000Z',
    source: 'itsaplan-ui',
    actor: { type: 'human', id: 'owner' },
    context: {
      organizationRef: 'organization:1',
      projectRef: 'project:DEMO',
      capabilityRefs: [],
      connectionRefs: [],
    },
    dryRun,
    payload: { schemaVersion: 1, pipelineId: 1 },
  };
}

function instance(adapter: PlanPipelineAdapter) {
  return new Mastra({
    workflows: { pipeline: buildPipelineWorkflow(adapter) },
    storage: new LibSQLStore({ id: 'plan-pipeline', url: process.env.STUDIO_DATABASE_URL! }),
  });
}

async function start(adapter: PlanPipelineAdapter, dryRun = false) {
  const mastra = instance(adapter);
  const input = envelope(dryRun);
  const run = await mastra.getWorkflow('pipeline').createRun({ runId: input.eventId });
  return { mastra, run, result: await run.start({ inputData: input }) };
}

test('the next step follows the lanes of conditions and ends where a lane ends the run', () => {
  const steps: PipelineStep[] = [
    agent('build'),
    {
      ...outcome('built', [action('comment'), outcome('nested', [action('deep')])], []),
      elseEnd: true,
    },
    action('close'),
  ];
  assert.equal(stepAfter(steps, 'build'), 'built');
  assert.equal(stepAfter(steps, 'comment'), 'nested');
  assert.equal(stepAfter(steps, 'deep'), 'close');
  assert.equal(stepAfter(steps, 'close'), null);
  assert.equal(branchStart(steps, 'built', true), 'comment');
  assert.equal(branchStart(steps, 'built', false), null);
  assert.equal(branchStart(steps, 'nested', false), 'close');
  assert.equal(handlesOutcome(steps, 'built'), true);
  assert.equal(handlesOutcome(steps, 'close'), false);
  assert.throws(() => stepAfter(steps, 'missing'), /no step missing/);
});

test('a run executes every kind of step in order and records each with Plan', async () => {
  const plan = fakePlan(
    [
      agent('implement'),
      outcome('implemented', [action('comment')], [action('flag')]),
      { id: 'pause', name: 'Pause', type: 'wait' },
      approval('approve'),
      agent('notes'),
    ],
    { wakeAt: new Date(Date.now() + 50).toISOString() },
  );
  const { run, result } = await start(plan.adapter);
  assert.equal(result.status, 'suspended');
  assert.deepEqual(plan.executed(), ['implement#1', 'implemented#1', 'comment#1', 'pause#1', 'approve#1']);
  assert.ok(
    plan.calls.some(
      (call) => call.operation === 'record' && call.body.stepId === 'pause' && call.body.status === 'succeeded',
    ),
  );

  const resumed = await run.resume({
    step: 'run-pipeline-step',
    resumeData: { approved: true, decidedBy: 'owner', note: 'Ship it.' },
  });
  assert.equal(resumed.status, 'success');
  if (resumed.status !== 'success') return;
  assert.equal(resumed.result.status, 'succeeded');
  assert.equal(resumed.result.executedSteps, 6);
  assert.deepEqual(plan.executed().slice(-1), ['notes#1']);
  const decided = plan.calls.find((call) => call.operation === 'approval' && call.body.phase === 'decided');
  assert.deepEqual(
    { approved: decided?.body.approved, note: decided?.body.note, decidedBy: decided?.body.decidedBy, seq: decided?.body.seq },
    { approved: true, note: 'Ship it.', decidedBy: 'owner', seq: 5 },
  );
  assert.deepEqual(plan.agentRuns.map((request) => request.policy), [{ maxTurns: 20 }, { maxTurns: 20 }]);
  assert.deepEqual(plan.calls.at(-1), {
    operation: 'finish',
    body: { runId: run.runId, projectRef: 'project:DEMO', status: 'succeeded' },
  });
});

test('a condition takes the lane of its answer and an empty lane continues after it', async () => {
  const plan = fakePlan(
    [
      { id: 'check', name: 'Check', type: 'condition', condition: { kind: 'task' }, then: [action('a')], else: [] },
      { id: 'again', name: 'Again', type: 'condition', condition: { kind: 'keyword' }, then: [], else: [action('b')], thenEnd: true },
      action('never'),
    ],
    { conditions: { check: [false], again: [true] } },
  );
  const { result } = await start(plan.adapter);
  assert.equal(result.status, 'success');
  assert.deepEqual(plan.executed(), ['check#1', 'again#1']);
});

test('a rejection sends the run back to the rework step until the loop guard ends it', async () => {
  const plan = fakePlan([agent('implement'), approval('approve', { action: 'goto', stepId: 'implement', maxLoops: 2 }), action('publish')]);
  const { run, result } = await start(plan.adapter);
  assert.equal(result.status, 'suspended');
  const reject = () =>
    run.resume({ step: 'run-pipeline-step', resumeData: { approved: false, decidedBy: 'owner', note: 'Not yet.' } });
  assert.equal((await reject()).status, 'suspended');
  assert.equal((await reject()).status, 'suspended');
  const ended = await reject();
  assert.equal(ended.status, 'success');
  if (ended.status !== 'success') return;
  assert.equal(ended.result.status, 'rejected');
  assert.deepEqual(plan.executed(), [
    'implement#1',
    'approve#1',
    'implement#2',
    'approve#2',
    'implement#3',
    'approve#3',
  ]);
  const keys = new Set(plan.agentRuns.map((request) => request.idempotencyKey));
  assert.equal(keys.size, 3);
  assert.equal(plan.calls.at(-1)?.body.status, 'rejected');
});

test('a failed agent step fails the run unless an outcome condition follows it', async () => {
  const failing = async (): Promise<AgentResult> => ({ agentRunId: 9, outcome: 'failed', summary: 'Tests fail' });
  const unhandled = fakePlan([agent('implement'), action('publish')], { agent: failing });
  const failed = await start(unhandled.adapter);
  assert.equal(failed.result.status, 'failed');
  const records = unhandled.calls.filter((call) => call.operation === 'record');
  assert.deepEqual(
    records.map((call) => call.body.status),
    ['failed', 'failed'],
  );
  assert.equal(unhandled.calls.at(-1)?.operation, 'finish');
  assert.equal(unhandled.calls.at(-1)?.body.status, 'failed');
  assert.match(String(unhandled.calls.at(-1)?.body.error), /Tests fail/);

  const handled = fakePlan([agent('implement'), outcome('ok', [action('publish')], [action('reopen')])], {
    agent: failing,
    conditions: { ok: [false] },
  });
  const branched = await start(handled.adapter);
  assert.equal(branched.result.status, 'success');
  assert.deepEqual(handled.executed(), ['implement#1', 'ok#1', 'reopen#1']);
});

test('a dry run simulates agents and approvals', async () => {
  const plan = fakePlan([agent('implement'), approval('approve'), action('publish')], { dryRun: true });
  const { result } = await start(plan.adapter, true);
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.result.status, 'dry-run-complete');
  assert.equal(plan.agentRuns.length, 0);
  assert.deepEqual(plan.executed(), ['implement#1', 'approve#1', 'publish#1']);
});

test('canceling a run aborts the agent run it waits for and records nothing more', { timeout: 10_000 }, async () => {
  let started: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted = false;
  const plan = fakePlan([agent('implement'), action('publish')], {
    agent: (_, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
        started();
      }),
  });
  const mastra = instance(plan.adapter);
  const input = envelope();
  const run = await mastra.getWorkflow('pipeline').createRun({ runId: input.eventId });
  const result = run.start({ inputData: input });
  await waiting;
  await run.cancel();
  assert.equal((await result).status, 'canceled');
  assert.equal(aborted, true);
  assert.ok(!plan.calls.some((call) => call.operation === 'record' || call.operation === 'finish'));
});

test('a retry runs the failed step again and keeps the steps before it', async () => {
  let fail = true;
  const plan = fakePlan([agent('implement'), agent('review'), action('publish')], {
    agent: async (request) =>
      fail && request.prompt === 'Do review'
        ? Promise.reject(new Error('bridge unavailable'))
        : { agentRunId: 1, outcome: 'success', summary: 'ok' },
  });
  const { mastra, run, result } = await start(plan.adapter);
  assert.equal(result.status, 'failed');
  fail = false;
  // What the control API's retry does: time travel to the failed step with its input.
  const stored = await mastra.getWorkflow('pipeline').getWorkflowRunById(run.runId);
  const failed = stored?.steps['run-pipeline-step'] as { status: string; payload: unknown };
  assert.equal(failed.status, 'failed');
  const retried = await run.timeTravel({ step: 'run-pipeline-step', inputData: failed.payload });
  assert.equal(retried.status, 'success');
  assert.deepEqual(plan.executed(), ['implement#1', 'review#1', 'review#1', 'publish#1']);
});

test('a run continues after a restart from the step it was in with the same agent run', async () => {
  let reached: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const steps = [agent('implement'), agent('review'), action('publish')];
  const before = fakePlan(steps, {
    agent: (request) =>
      request.prompt === 'Do review'
        ? (reached(), new Promise<AgentResult>(() => {}))
        : Promise.resolve({ agentRunId: 1, outcome: 'success', summary: 'ok' }),
  });
  const input = envelope();
  const first = instance(before.adapter);
  const run = await first.getWorkflow('pipeline').createRun({ runId: input.eventId });
  void run.start({ inputData: input });
  await stopped;

  const after = fakePlan(steps);
  const second = instance(after.adapter);
  await restartActiveRuns(second);
  const stored = await second.getWorkflow('pipeline').getWorkflowRunById(run.runId);
  assert.equal(stored?.status, 'success');
  assert.deepEqual(after.executed(), ['review#1', 'publish#1']);
  const reviewBefore = before.calls.find((call) => call.operation === 'agent' && call.body.stepId === 'review');
  const reviewAfter = after.calls.find((call) => call.operation === 'agent' && call.body.stepId === 'review');
  assert.deepEqual(reviewAfter?.body, reviewBefore?.body);
  assert.equal(after.agentRuns[0].idempotencyKey, before.agentRuns[1].idempotencyKey);
});

test('a schedule fire that starts late is skipped without asking Plan', async () => {
  const plan = fakePlan([action('publish')]);
  const mastra = new Mastra({
    workflows: { pipeline: buildPipelineWorkflow(plan.adapter, () => Date.parse('2026-09-23T01:00:00Z')) },
    storage: new LibSQLStore({ id: 'plan-pipeline-late', url: process.env.STUDIO_DATABASE_URL! }),
  });
  const runId = `sched_pipeline-1_${Date.parse('2026-09-23T00:00:00Z')}`;
  const run = await mastra.getWorkflow('pipeline').createRun({ runId });
  const result = await run.start({ inputData: envelope() });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.result.status, 'skipped');
  assert.deepEqual(plan.calls, []);
});
