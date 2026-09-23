import assert from 'node:assert/strict';
import test from 'node:test';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import type { WorkEnvelope } from '../src/mastra/contracts.ts';
import type { HermesTeamAdapter, StageRequest } from '../src/mastra/adapters/hermes-team.ts';
import {
  agentTeamPayloadSchema,
  type Delegation,
  type StageResult,
} from '../src/mastra/team-contracts.ts';
import { buildAgentTeamWorkflow, dependencyWaves, routeTask } from '../src/mastra/team-workflow.ts';

const tester = { agentRef: 'agent:demo-tester', role: 'specialist', capabilities: ['test'] };
const designer = { agentRef: 'agent:demo-designer', role: 'specialist', capabilities: ['frontend'] };

function payload(overrides: Record<string, unknown> = {}, task: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    task: {
      taskRef: 'task:DEMO-1',
      title: 'Verify integration',
      objective: 'Verify the integration contract.',
      acceptanceCriteria: ['Focused tests pass'],
      ...task,
    },
    coordinator: { agentRef: 'agent:demo-coordinator', role: 'coordinator', capabilities: [] },
    specialists: [tester],
    policy: { maxAttempts: 3, initialBackoffMs: 50, maxBackoffMs: 100, backoffMultiplier: 2 },
    execution: { model: 'luna', reasoning: 'low' },
    ...overrides,
  };
}

function envelope(dryRun: boolean, teamPayload: Record<string, unknown>): WorkEnvelope {
  return {
    eventId: 'team-event-001',
    correlationId: 'task:DEMO-1',
    occurredAt: '2026-09-23T00:00:00.000Z',
    source: 'test',
    actor: { type: 'human', id: 'test-operator' },
    context: {
      organizationRef: 'organization:volition',
      projectRef: 'project:DEMO',
      capabilityRefs: ['hermes-team.v1', 'plan-task-sync.v1'],
      connectionRefs: [],
    },
    dryRun,
    payload: teamPayload,
  };
}

function stage(
  phase: StageResult['phase'],
  idempotencyKey: string,
  extra: Partial<StageResult> = {},
): StageResult {
  return {
    executionId: `${phase}-execution`,
    idempotencyKey,
    phase,
    status: 'completed',
    attempt: 1,
    startedAt: '2026-09-23T00:00:00.000Z',
    completedAt: '2026-09-23T00:00:01.000Z',
    summary: `${phase} completed`,
    evidence: [],
    delegations: [],
    lease: {
      claimedAt: '2026-09-23T00:00:00.000Z',
      heartbeatAt: '2026-09-23T00:00:00.500Z',
      expiresAt: '2026-09-23T00:02:00.500Z',
    },
    ...extra,
  };
}

function delegation(assignmentId: string, agentRef: string, dependsOn: string[] = []): Delegation {
  return {
    assignmentId,
    agentRef,
    objective: `Do ${assignmentId}.`,
    acceptanceCriteria: ['Done'],
    dependsOn,
  };
}

// An adapter that records every stage request and answers each phase with a completed
// stage: the coordinator plans `delegations`, the review decides `accepted`.
function recordingAdapter(
  options: {
    delegations?: Delegation[];
    accepted?: boolean;
    specialize?: (request: StageRequest) => Promise<void>;
  } = {},
) {
  const requests: StageRequest[] = [];
  const calls: string[] = [];
  const syncs: { state: string; summary: string }[] = [];
  const adapter: HermesTeamAdapter = {
    async executeStage(request) {
      requests.push(request);
      calls.push(request.assignment ? `specialize:${request.agent.agentRef}` : request.phase);
      if (request.phase === 'coordinate') {
        return stage('coordinate', request.idempotencyKey, {
          delegations: options.delegations ?? [delegation('a', tester.agentRef)],
        });
      }
      if (request.phase === 'specialize') {
        await options.specialize?.(request);
        return stage('specialize', request.idempotencyKey, {
          summary: `${request.assignment!.assignmentId} finished`,
          evidence: [
            {
              kind: 'test',
              ref: `test:${request.assignment!.assignmentId}`,
              label: `${request.assignment!.assignmentId} passes`,
            },
          ],
        });
      }
      return stage('review', request.idempotencyKey, {
        review: { accepted: options.accepted ?? true, notes: 'Acceptance criteria reviewed.' },
      });
    },
    async synchronizePlan(request) {
      calls.push(`sync:${request.state}`);
      syncs.push({ state: request.state, summary: request.summary });
      return { synchronizedAt: '2026-09-23T00:00:05.000Z' };
    },
  };
  return { adapter, requests, calls, syncs };
}

async function run(adapter: HermesTeamAdapter, dryRun: boolean, teamPayload: Record<string, unknown>) {
  const workflowRun = await buildAgentTeamWorkflow(adapter).createRun();
  return workflowRun.start({ inputData: envelope(dryRun, teamPayload) });
}

test('routes to the only specialist without a coordinator stage', () => {
  const input = agentTeamPayloadSchema.parse(payload());
  assert.deepEqual(routeTask(input), {
    agentRef: tester.agentRef,
    reason: 'the team has one specialist',
  });
});

test('routes by labels only when they match the capabilities of exactly one specialist', () => {
  const team = { specialists: [tester, designer] };
  const route = (labels: string[]) =>
    routeTask(agentTeamPayloadSchema.parse(payload(team, { labels })));
  assert.equal(route(['Frontend', 'bug'])?.agentRef, designer.agentRef);
  assert.equal(route(['frontend', 'test']), null);
  assert.equal(route(['docs']), null);
  assert.equal(route([]), null);
});

test('orders dependent assignments into waves and rejects invalid dependencies', () => {
  const waves = dependencyWaves([
    delegation('c', tester.agentRef, ['a', 'b']),
    delegation('a', tester.agentRef),
    delegation('b', designer.agentRef, ['a']),
    delegation('d', designer.agentRef),
  ]);
  assert.deepEqual(
    waves.map((wave) => wave.map((item) => item.assignmentId)),
    [['a', 'd'], ['b'], ['c']],
  );
  assert.throws(
    () => dependencyWaves([delegation('a', tester.agentRef, ['missing'])]),
    /unknown assignment missing/,
  );
  assert.throws(
    () =>
      dependencyWaves([
        delegation('a', tester.agentRef, ['b']),
        delegation('b', tester.agentRef, ['a']),
      ]),
    /cycle/,
  );
  assert.throws(() => dependencyWaves([delegation('a', tester.agentRef, ['a'])]), /cycle/);
  assert.throws(
    () => dependencyWaves([delegation('a', tester.agentRef), delegation('a', designer.agentRef)]),
    /delegated twice/,
  );
});

test('a dry-run records the routing and calls neither Hermes nor Plan', async () => {
  const adapter: HermesTeamAdapter = {
    executeStage: async () => {
      throw new Error('unexpected Hermes call');
    },
    synchronizePlan: async () => {
      throw new Error('unexpected Plan call');
    },
  };
  const result = await run(adapter, true, payload());
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.result.status, 'dry-run-complete');
  assert.equal(result.result.planSync.state, 'simulated');
  assert.deepEqual(
    result.result.history.map((entry) => entry.phase),
    ['route'],
  );
});

test('a single specialist gets the task directly and the routing is in the history', async () => {
  const recorder = recordingAdapter();
  const result = await run(recorder.adapter, false, payload());
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.deepEqual(recorder.calls, [`specialize:${tester.agentRef}`, 'review', 'sync:review']);
  assert.deepEqual(
    result.result.history.map((entry) => entry.phase),
    ['route', 'specialize', 'review'],
  );
  assert.match(result.result.history[0].summary, /without a coordinator stage/);
  assert.deepEqual(recorder.requests[0].assignment?.acceptanceCriteria, ['Focused tests pass']);
});

test('a label matching one specialist skips the coordinator stage', async () => {
  const recorder = recordingAdapter();
  const result = await run(
    recorder.adapter,
    false,
    payload({ specialists: [tester, designer] }, { labels: ['frontend'] }),
  );
  assert.equal(result.status, 'success');
  assert.deepEqual(recorder.calls, [`specialize:${designer.agentRef}`, 'review', 'sync:review']);
});

test('the coordinator plans when the labels do not decide', async () => {
  const recorder = recordingAdapter({
    delegations: [delegation('a', tester.agentRef), delegation('b', designer.agentRef)],
  });
  const result = await run(
    recorder.adapter,
    false,
    payload({ specialists: [tester, designer] }, { labels: ['bug'] }),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(recorder.calls[0], 'coordinate');
  assert.deepEqual(recorder.calls.slice(1, 3).sort(), [
    `specialize:${designer.agentRef}`,
    `specialize:${tester.agentRef}`,
  ]);
  assert.deepEqual(
    result.result.evidence.map((item) => item.ref).sort(),
    ['test:a', 'test:b'],
  );
});

test('dependent assignments run after their dependencies and receive their results', async () => {
  const started: string[] = [];
  const finished: string[] = [];
  let bothStarted: () => void = () => {};
  const parallel = new Promise<void>((resolve) => {
    bothStarted = resolve;
  });
  const recorder = recordingAdapter({
    delegations: [
      delegation('a', tester.agentRef),
      delegation('b', designer.agentRef, ['a']),
      delegation('c', tester.agentRef, ['a']),
    ],
    async specialize(request) {
      const id = request.assignment!.assignmentId;
      started.push(id);
      if (id !== 'a') {
        if (started.includes('b') && started.includes('c')) bothStarted();
        await Promise.race([
          parallel,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('b and c did not run in parallel')), 1_000),
          ),
        ]);
      }
      finished.push(id);
    },
  });
  const result = await run(
    recorder.adapter,
    false,
    payload({ specialists: [tester, designer] }),
  );
  assert.equal(result.status, 'success');
  assert.equal(finished[0], 'a');
  assert.deepEqual(started.slice(1).sort(), ['b', 'c']);
  const dependent = recorder.requests.find((request) => request.assignment?.assignmentId === 'b');
  assert.deepEqual(dependent?.dependencyResults, [
    {
      assignmentId: 'a',
      summary: 'a finished',
      evidence: [{ kind: 'test', ref: 'test:a', label: 'a passes' }],
    },
  ]);
  const independent = recorder.requests.find((request) => request.assignment?.assignmentId === 'a');
  assert.equal(independent?.dependencyResults, undefined);
});

test('canceling the run aborts the Hermes stage it waits for', { timeout: 10_000 }, async () => {
  let started: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const signals: (AbortSignal | undefined)[] = [];
  const adapter: HermesTeamAdapter = {
    executeStage: (_request, signal) =>
      new Promise((_resolve, reject) => {
        signals.push(signal);
        started();
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    synchronizePlan: async () => {
      throw new Error('unexpected Plan call');
    },
  };
  const workflowRun = await buildAgentTeamWorkflow(adapter).createRun();
  const result = workflowRun.start({ inputData: envelope(false, payload()) });
  await waiting;
  await workflowRun.cancel();
  assert.equal((await result).status, 'canceled');
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.aborted, true);
});

test('a dependency cycle from the coordinator stops the run before specialist work', async () => {
  const recorder = recordingAdapter({
    delegations: [
      delegation('a', tester.agentRef, ['b']),
      delegation('b', designer.agentRef, ['a']),
    ],
  });
  const result = await run(recorder.adapter, false, payload({ specialists: [tester, designer] }));
  assert.equal(result.status, 'failed');
  assert.deepEqual(recorder.calls, ['coordinate']);
});

test('a failed stage is not retried by Mastra on top of the adapter', async () => {
  let calls = 0;
  const adapter: HermesTeamAdapter = {
    executeStage: async () => {
      calls += 1;
      throw new Error('Hermes execution stage failed');
    },
    synchronizePlan: async () => {
      throw new Error('unexpected Plan call');
    },
  };
  const result = await run(adapter, false, payload());
  assert.equal(result.status, 'failed');
  assert.equal(calls, 1);
});

test('a retry runs the failed stage again and keeps the stages before it', async () => {
  let failing = true;
  const recorder = recordingAdapter({
    delegations: [delegation('a', tester.agentRef), delegation('b', designer.agentRef)],
    async specialize() {
      if (failing) throw new Error('Hermes execution stage failed');
    },
  });
  const mastra = new Mastra({
    workflows: { agentTeam: buildAgentTeamWorkflow(recorder.adapter) },
    storage: new LibSQLStore({ id: 'agent-team-retry', url: process.env.STUDIO_DATABASE_URL! }),
  });
  const workflowRun = await mastra.getWorkflow('agentTeam').createRun();
  const failed = await workflowRun.start({
    inputData: envelope(false, payload({ specialists: [tester, designer] })),
  });
  assert.equal(failed.status, 'failed');

  failing = false;
  const retried = await workflowRun.timeTravel({ step: 'specialize' });
  assert.equal(retried.status, 'success');
  assert.equal(recorder.calls.filter((call) => call === 'coordinate').length, 1);
  assert.equal(recorder.calls.filter((call) => call.startsWith('specialize:')).length, 4);
  assert.deepEqual(recorder.calls.slice(-2), ['review', 'sync:review']);
});

test('run limits travel with every Hermes stage and the stage timeout covers the budget', async () => {
  const recorder = recordingAdapter({
    delegations: [delegation('a', tester.agentRef), delegation('b', designer.agentRef)],
  });
  const policy = { maxTurns: 30, runBudgetSeconds: 600, timeoutSeconds: 900 };
  const result = await run(
    recorder.adapter,
    false,
    payload({ specialists: [tester, designer], policy }),
  );
  assert.equal(result.status, 'success');
  assert.equal(recorder.requests.length, 4);
  for (const request of recorder.requests) {
    assert.equal(request.policy.maxTurns, 30);
    assert.equal(request.policy.runBudgetSeconds, 600);
    assert.equal(request.policy.timeoutSeconds, 900);
  }
  const budget = recordingAdapter();
  await run(budget.adapter, false, payload({ policy: { runBudgetSeconds: 7_000 } }));
  assert.equal(budget.requests[0].policy.timeoutSeconds, 7_200);
  const short = recordingAdapter();
  await run(short.adapter, false, payload({ policy: { runBudgetSeconds: 60 } }));
  assert.equal(short.requests[0].policy.timeoutSeconds, 900);
  assert.throws(() => agentTeamPayloadSchema.parse(payload({ policy: { maxTurns: 201 } })));
  assert.throws(() => agentTeamPayloadSchema.parse(payload({ policy: { runBudgetSeconds: 59 } })));
});

test('an omitted policy takes every default', () => {
  const { policy, execution } = agentTeamPayloadSchema.parse(
    payload({ policy: undefined, execution: undefined }),
  );
  assert.deepEqual(policy, {
    maxAttempts: 3,
    initialBackoffMs: 1_000,
    maxBackoffMs: 30_000,
    backoffMultiplier: 2,
    leaseSeconds: 300,
    heartbeatSeconds: 60,
    timeoutSeconds: 900,
    reviewRequired: true,
    autonomy: 'review',
  });
  assert.deepEqual(execution, {});
});

test('autonomy review keeps accepted work in Review', async () => {
  const recorder = recordingAdapter({ accepted: true });
  const result = await run(recorder.adapter, false, payload());
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.result.status, 'review');
  assert.deepEqual(recorder.syncs, [{ state: 'review', summary: 'Acceptance criteria reviewed.' }]);
});

test('autonomy done moves accepted work to Done and rejected work to Review', async () => {
  const accepted = recordingAdapter({ accepted: true });
  const done = await run(accepted.adapter, false, payload({ policy: { autonomy: 'done' } }));
  assert.equal(done.status, 'success');
  if (done.status !== 'success') return;
  assert.equal(done.result.status, 'done');
  assert.equal(done.result.planSync.state, 'done');

  const rejected = recordingAdapter({ accepted: false });
  const review = await run(rejected.adapter, false, payload({ policy: { autonomy: 'done' } }));
  assert.equal(review.status, 'success');
  if (review.status !== 'success') return;
  assert.equal(review.result.status, 'review');
});

test('without a required review the specialist summaries go to Review', async () => {
  const recorder = recordingAdapter({
    delegations: [delegation('a', tester.agentRef), delegation('b', designer.agentRef, ['a'])],
  });
  const result = await run(
    recorder.adapter,
    false,
    payload({ specialists: [tester, designer], policy: { reviewRequired: false, autonomy: 'done' } }),
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.ok(!recorder.calls.includes('review'));
  assert.deepEqual(recorder.syncs, [{ state: 'review', summary: 'a finished\n\nb finished' }]);
});
