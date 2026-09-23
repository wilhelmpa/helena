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

test('HTTP bridge requires the private bearer and preserves the stage contract', async () => {
  const service = {
    executeStage: async value => ({ executionId: 'plan-run:1', idempotencyKey: value.idempotencyKey }),
    synchronize: async value => ({ idempotencyKey: value.idempotencyKey, synchronizedAt: '2026-09-23T10:00:00.000Z' }),
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
});
