import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, test } from 'node:test';
import { createHermesTeamService, HermesTeamError } from '../hermes-team-bridge-core.mjs';
import { createHermesTeamHandler } from '../hermes-team-bridge.mjs';

const TOKEN = 'bridge-token-0123456789abcdef0123456789';
const KEY = 'a'.repeat(64);
const baseStage = {
  schemaVersion: 1,
  phase: 'coordinate',
  idempotencyKey: KEY,
  projectRef: 'project:VERV',
  task: {
    taskRef: 'task:VERV-1',
    title: 'Verify integration',
    objective: 'Prove the coordinator delegates the bounded work.',
    acceptanceCriteria: ['Contract passes'],
  },
  agent: { agentRef: 'agent:coordinator', role: 'Coordinator', capabilities: [] },
  allowedSpecialists: [
    { agentRef: 'agent:tester', role: 'Tester', capabilities: ['test'] },
  ],
  policy: { timeoutSeconds: 30 },
  execution: { model: 'luna', reasoning: 'low' },
};

let server;
afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  server = null;
});

function completedRun(output, runId = 41) {
  return {
    runId,
    status: 'success',
    attempts: 2,
    output: JSON.stringify(output),
    claimedAt: '2026-09-23T10:00:00.000Z',
    heartbeatAt: '2026-09-23T10:00:10.000Z',
    expiresAt: '2026-09-23T10:02:10.000Z',
    finishedAt: '2026-09-23T10:00:20.000Z',
  };
}

test('coordinator stage is project-bound and returns a validated lease', async () => {
  let queued;
  const service = createHermesTeamService({
    enqueue: async input => {
      queued = input;
      return { runId: 41, replayed: false };
    },
    status: async () => completedRun({
      summary: 'Delegated verification.',
      delegations: [{
        assignmentId: 'test-contract',
        agentRef: 'agent:tester',
        objective: 'Run the contract tests.',
        acceptanceCriteria: ['Contract passes'],
        dependsOn: [],
      }],
    }),
  });
  const result = await service.executeStage(baseStage);
  assert.equal(queued.projectRef, 'project:VERV');
  assert.equal(queued.task.taskRef, 'task:VERV-1');
  assert.deepEqual(queued.execution, { model: 'luna', reasoning: 'low' });
  assert.deepEqual(queued.policy, baseStage.policy);
  assert.equal(result.executionId, 'plan-run:41');
  assert.equal(result.attempt, 2);
  assert.equal(result.delegations[0].agentRef, 'agent:tester');
});

test('a dependent specialist stage carries the results of its dependencies and the run limits', async () => {
  let queued;
  const service = createHermesTeamService({
    enqueue: async input => {
      queued = input;
      return { runId: 42, replayed: false };
    },
    status: async () => completedRun({ summary: 'Built on the contract run.', evidence: [] }, 42),
  });
  const dependencyResults = [{
    assignmentId: 'test-contract',
    summary: 'Contract tests pass.',
    evidence: [{ kind: 'test', ref: 'test:contract', label: 'Contract passed' }],
  }];
  await service.executeStage({
    ...baseStage,
    phase: 'specialize',
    allowedSpecialists: undefined,
    agent: { agentRef: 'agent:tester', role: 'specialist', capabilities: ['test'] },
    assignment: {
      assignmentId: 'release-notes',
      agentRef: 'agent:tester',
      objective: 'Write the release notes.',
      acceptanceCriteria: ['Notes cite the contract run'],
      dependsOn: ['test-contract'],
    },
    dependencyResults,
    policy: { timeoutSeconds: 30, maxTurns: 12, runBudgetSeconds: 600 },
  });
  assert.match(queued.prompt, /Results of the assignments this assignment depends on/);
  assert.ok(queued.prompt.includes(JSON.stringify(dependencyResults)));
  assert.deepEqual(queued.policy, { timeoutSeconds: 30, maxTurns: 12, runBudgetSeconds: 600 });
});

test('a stage whose agent marked the task blocked fails with the question', async () => {
  const service = createHermesTeamService({
    enqueue: async () => ({ runId: 41, replayed: false }),
    status: async () => ({ ...completedRun({}), output: 'I need input.', blockedQuestion: 'Which market first?' }),
  });
  await assert.rejects(
    () => service.executeStage(baseStage),
    error =>
      error instanceof HermesTeamError &&
      error.status === 409 &&
      error.code === 'hermes_run_blocked' &&
      error.message === 'The agent is blocked and needs input: Which market first?',
  );
});

test('rejects coordinator delegation outside the supplied project team', async () => {
  const service = createHermesTeamService({
    enqueue: async () => ({ runId: 41, replayed: false }),
    status: async () => completedRun({
      summary: 'Delegated elsewhere.',
      delegations: [{
        assignmentId: 'escape',
        agentRef: 'agent:other-project',
        objective: 'Do work elsewhere.',
        acceptanceCriteria: ['Done'],
        dependsOn: [],
      }],
    }),
  });
  await assert.rejects(
    () => service.executeStage(baseStage),
    error => error instanceof HermesTeamError && error.code === 'invalid_hermes_output',
  );
});

test('recovery retries the same idempotency key after a bridge interruption', async () => {
  const enqueued = [];
  let statusCalls = 0;
  const plan = {
    enqueue: async input => {
      enqueued.push(input.idempotencyKey);
      return { runId: 77, replayed: enqueued.length > 1 };
    },
    status: async () => {
      statusCalls += 1;
      if (statusCalls === 1) throw new HermesTeamError(502, 'plan_unavailable', 'Plan is unavailable');
      return completedRun({
        summary: 'Recovered the existing run.',
        delegations: [{
          assignmentId: 'test-contract',
          agentRef: 'agent:tester',
          objective: 'Run the contract tests.',
          acceptanceCriteria: ['Contract passes'],
          dependsOn: [],
        }],
      }, 77);
    },
  };
  const service = createHermesTeamService(plan);
  await assert.rejects(() => service.executeStage(baseStage), /Plan is unavailable/);
  const recovered = await service.executeStage(baseStage);
  assert.equal(recovered.executionId, 'plan-run:77');
  assert.deepEqual(enqueued, [KEY, KEY]);
});

test('a stage Mastra stops waiting for cancels its Plan run and stops polling', async () => {
  const mastra = new AbortController();
  const canceled = [];
  let statusCalls = 0;
  const service = createHermesTeamService({
    enqueue: async () => ({ runId: 43, replayed: false }),
    status: async () => {
      statusCalls += 1;
      mastra.abort();
      return { runId: 43, status: 'pending' };
    },
    cancel: async input => {
      canceled.push(input);
      return { runId: 43, status: 'canceled' };
    },
  });
  await assert.rejects(
    () => service.executeStage(baseStage, mastra.signal),
    error => error instanceof HermesTeamError && error.code === 'stage_canceled',
  );
  assert.equal(statusCalls, 1);
  assert.deepEqual(canceled, [{ runId: 43, projectRef: 'project:VERV' }]);
});

test('synchronization is project-bound and safely replays the same idempotency key', async () => {
  const calls = [];
  const service = createHermesTeamService({
    synchronize: async input => {
      calls.push(input);
      return { idempotencyKey: input.idempotencyKey, synchronizedAt: '2026-09-23T10:00:30.000Z' };
    },
  });
  const request = {
    schemaVersion: 1,
    idempotencyKey: KEY,
    projectRef: 'project:VERV',
    taskRef: 'task:VERV-1',
    state: 'done',
    summary: 'All acceptance criteria passed.',
    evidence: [{ kind: 'test', ref: 'test:contract', label: 'Contract passed' }],
  };
  const first = await service.synchronize(request);
  const replay = await service.synchronize(request);
  assert.deepEqual(first, replay);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.idempotencyKey), [KEY, KEY]);
  await assert.rejects(
    () => service.synchronize({ ...request, taskRef: 'task:OTHER-1' }),
    error => error instanceof HermesTeamError && error.code === 'invalid_sync_request',
  );
});

test('a routine request is project-bound and reaches Plan unchanged', async () => {
  const calls = [];
  const service = createHermesTeamService({
    routine: async input => {
      calls.push(input);
      return { idempotencyKey: input.idempotencyKey, outcome: 'created', taskRef: 'task:VERV-2' };
    },
  });
  const request = {
    schemaVersion: 1,
    idempotencyKey: KEY,
    projectRef: 'project:VERV',
    agentRef: 'agent:writer',
    title: 'Weekly report',
    instructions: 'Summarize the week.',
    mode: 'new',
    taskRef: 'task:VERV-1',
    actorId: 'user-1',
  };
  assert.deepEqual(await service.routine(request), {
    idempotencyKey: KEY,
    outcome: 'created',
    taskRef: 'task:VERV-2',
  });
  const { schemaVersion, ...forwarded } = request;
  assert.equal(schemaVersion, 1);
  assert.deepEqual(calls, [forwarded]);
  for (const invalid of [
    { ...request, taskRef: 'task:OTHER-1' },
    { ...request, mode: 'reopen', taskRef: undefined },
    { ...request, mode: 'later' },
    { ...request, idempotencyKey: 'short' },
    { ...request, instructions: '' },
  ]) {
    await assert.rejects(
      () => service.routine(invalid),
      error => error instanceof HermesTeamError && error.code === 'invalid_routine_request',
    );
  }
  assert.equal(calls.length, 1);
});

test('HTTP bridge requires the private bearer and preserves the stage contract', async () => {
  let stageSignal;
  const service = {
    executeStage: async (value, signal) => {
      stageSignal = signal;
      return { executionId: 'plan-run:1', idempotencyKey: value.idempotencyKey };
    },
    synchronize: async value => ({ idempotencyKey: value.idempotencyKey, synchronizedAt: '2026-09-23T10:00:00.000Z' }),
    routine: async value => ({ idempotencyKey: value.idempotencyKey, outcome: 'skipped' }),
  };
  server = http.createServer(createHermesTeamHandler({ bridgeToken: TOKEN, planToken: TOKEN }, service));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const denied = await fetch(`${origin}/internal/hermes/team/stages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(baseStage),
  });
  assert.equal(denied.status, 401);
  const response = await fetch(`${origin}/internal/hermes/team/stages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(baseStage),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { executionId: 'plan-run:1', idempotencyKey: KEY });
  assert.equal(stageSignal.aborted, false);
  const routine = await fetch(`${origin}/internal/hermes/team/routine`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: KEY }),
  });
  assert.equal(routine.status, 200);
  assert.deepEqual(await routine.json(), { idempotencyKey: KEY, outcome: 'skipped' });
});

test('HTTP bridge aborts a stage when Mastra closes the connection before the answer', { timeout: 5_000 }, async () => {
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  let aborted;
  const abandoned = new Promise(resolve => { aborted = resolve; });
  const service = {
    executeStage: (value, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted();
        reject(new HermesTeamError(499, 'stage_canceled', 'canceled'));
      });
      started();
    }),
    synchronize: async () => ({}),
  };
  server = http.createServer(createHermesTeamHandler({ bridgeToken: TOKEN, planToken: TOKEN }, service));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const mastra = new AbortController();
  const request = fetch(`http://127.0.0.1:${server.address().port}/internal/hermes/team/stages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(baseStage),
    signal: mastra.signal,
  });
  await waiting;
  mastra.abort();
  await assert.rejects(request);
  await abandoned;
});
