import assert from 'node:assert/strict';
import test from 'node:test';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { createHermesTeamService } from '../../../integration/hermes-team-bridge-core.mjs';
import { restartActiveRuns } from '../src/mastra/index.ts';
import {
  createHermesTeamAdapter,
  type BridgeRequest,
  type StageRequest,
} from '../src/mastra/adapters/hermes-team.ts';
import type { WorkEnvelope } from '../src/mastra/contracts.ts';
import { buildAgentTeamWorkflow } from '../src/mastra/team-workflow.ts';

// What happens to an agent-team stage when the processes around it stop: the workflow
// run is canceled, the bridge restarts, or Mastra restarts while the stage's Plan run
// executes.

const noWait = async () => {};

function stageRequest(): StageRequest {
  return {
    phase: 'specialize',
    idempotencyKey: 'b'.repeat(64),
    workflowRunId: 'team-run-1',
    projectRef: 'project:DEMO',
    task: {
      taskRef: 'task:DEMO-1',
      title: 'Verify integration',
      objective: 'Verify the integration contract.',
      acceptanceCriteria: ['Focused tests pass'],
      labels: [],
    },
    agent: { agentRef: 'agent:demo-tester', role: 'specialist', capabilities: [] },
    policy: {
      maxAttempts: 1,
      initialBackoffMs: 1,
      maxBackoffMs: 1,
      backoffMultiplier: 2,
      leaseSeconds: 300,
      heartbeatSeconds: 60,
      timeoutSeconds: 900,
      reviewRequired: true,
      autonomy: 'review',
    },
    execution: {},
  };
}

function completedRun(runId: number, output: unknown) {
  return {
    runId,
    status: 'success',
    attempts: 1,
    output: JSON.stringify(output),
    claimedAt: '2026-09-23T10:00:00.000Z',
    heartbeatAt: '2026-09-23T10:00:10.000Z',
    expiresAt: '2026-09-23T10:02:10.000Z',
    finishedAt: '2026-09-23T10:00:20.000Z',
  };
}

function stageResult(request: StageRequest) {
  return {
    executionId: 'plan-run:5',
    idempotencyKey: request.idempotencyKey,
    phase: request.phase,
    status: 'completed',
    attempt: 1,
    startedAt: '2026-09-23T10:00:00.000Z',
    completedAt: '2026-09-23T10:00:20.000Z',
    summary: 'Done',
    evidence: [],
    delegations: [],
    lease: {
      claimedAt: '2026-09-23T10:00:00.000Z',
      heartbeatAt: '2026-09-23T10:00:10.000Z',
      expiresAt: '2026-09-23T10:02:10.000Z',
    },
  };
}

function unreachable(code: string) {
  return Object.assign(new Error(`connect ${code} /run/volition-ipc/hermes-team.sock`), { code });
}

test('a canceled workflow run cancels the Plan run of its stage by key', async () => {
  const paths: { path: string; body: unknown }[] = [];
  let started: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const request: BridgeRequest = (path, body, _timeout, signal) => {
    paths.push({ path, body });
    if (path !== '/internal/hermes/team/stages') return Promise.resolve({});
    started();
    return new Promise((_resolve, reject) =>
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  const canceling = new AbortController();
  const stage = createHermesTeamAdapter(request, noWait).executeStage(
    stageRequest(),
    canceling.signal,
  );
  await waiting;
  canceling.abort();
  await assert.rejects(stage);
  assert.deepEqual(paths.at(-1), {
    path: '/internal/hermes/team/stages/cancel',
    body: { schemaVersion: 1, idempotencyKey: 'b'.repeat(64), projectRef: 'project:DEMO' },
  });
});

test('a bridge that restarts is waited for without spending the attempt', async () => {
  const failures = [unreachable('ENOENT'), unreachable('ECONNREFUSED'), unreachable('ECONNRESET')];
  const sent: StageRequest[] = [];
  const request: BridgeRequest = async (_path, body) => {
    const failure = failures.shift();
    if (failure) throw failure;
    sent.push(body as StageRequest);
    return stageResult(body as StageRequest);
  };
  const result = await createHermesTeamAdapter(request, noWait).executeStage(stageRequest());
  assert.equal(result.summary, 'Done');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].workflowRunId, 'team-run-1');

  const refusing: BridgeRequest = async () => {
    throw new Error('Hermes team bridge returned HTTP 409: the agent is paused');
  };
  await assert.rejects(
    createHermesTeamAdapter(refusing, noWait).executeStage(stageRequest()),
    /paused/,
  );
});

// A stand-in for Plan's run queue with its idempotency rule: a key asked for again gets
// its run, which is queued again only after it failed or was canceled.
function planQueue() {
  const runs = new Map<string, { runId: number; status: string; output?: unknown }>();
  const enqueued: string[] = [];
  const canceled: unknown[] = [];
  return {
    runs,
    enqueued,
    canceled,
    plan: {
      enqueue: async (input: { idempotencyKey: string }) => {
        enqueued.push(input.idempotencyKey);
        const run = runs.get(input.idempotencyKey);
        if (run) {
          if (run.status === 'failed' || run.status === 'canceled') run.status = 'pending';
          return { runId: run.runId, replayed: true };
        }
        const created = { runId: runs.size + 1, status: 'pending' };
        runs.set(input.idempotencyKey, created);
        return { runId: created.runId, replayed: false };
      },
      status: async (input: { runId: number }) => {
        const run = [...runs.values()].find((item) => item.runId === input.runId)!;
        return run.status === 'success'
          ? completedRun(run.runId, run.output)
          : { runId: run.runId, status: run.status };
      },
      cancel: async (input: unknown) => {
        canceled.push(input);
        return {};
      },
      synchronize: async (input: { idempotencyKey: string }) => ({
        idempotencyKey: input.idempotencyKey,
        synchronizedAt: '2026-09-23T10:01:00.000Z',
      }),
    },
  };
}

function inProcessBridge(service: ReturnType<typeof createHermesTeamService>): BridgeRequest {
  return async (path, body, _timeout, signal) => {
    if (path === '/internal/hermes/team/stages') return service.executeStage(body, signal);
    if (path === '/internal/hermes/team/stages/cancel') return service.cancelStage(body);
    if (path === '/internal/hermes/team/synchronize') return service.synchronize(body);
    throw new Error(`unexpected bridge path ${path}`);
  };
}

function envelope(): WorkEnvelope {
  return {
    eventId: 'team-event-restart',
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
    dryRun: false,
    payload: {
      schemaVersion: 1,
      task: {
        taskRef: 'task:DEMO-1',
        title: 'Verify integration',
        objective: 'Verify the integration contract.',
        acceptanceCriteria: ['Focused tests pass'],
      },
      coordinator: { agentRef: 'agent:demo-coordinator', role: 'coordinator', capabilities: [] },
      specialists: [{ agentRef: 'agent:demo-tester', role: 'specialist', capabilities: [] }],
      policy: { reviewRequired: false },
    },
  };
}

test('Mastra restarting during a stage continues it on the same Plan run', async () => {
  const queue = planQueue();
  const storage = () =>
    new LibSQLStore({ id: 'stage-recovery', url: process.env.STUDIO_DATABASE_URL! });

  // The first process queues the specialist stage, sees it pending and stops: its poll
  // never returns, which is what a Mastra that was stopped looks like to the stored run.
  let stopped: () => void = () => {};
  const stoppedWhileWaiting = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const beforeService = createHermesTeamService(queue.plan, {
    wait: () => {
      stopped();
      return new Promise(() => {});
    },
  });
  const before = new Mastra({
    workflows: {
      'agent-team': buildAgentTeamWorkflow(createHermesTeamAdapter(inProcessBridge(beforeService))),
    },
    storage: storage(),
  });
  const run = await before.getWorkflow('agent-team').createRun({ runId: 'team-event-restart' });
  void run.start({ inputData: envelope() });
  await stoppedWhileWaiting;
  assert.deepEqual([...queue.runs.values()].map((item) => item.status), ['pending']);

  // The runner finishes the stage's run while Mastra is down.
  const [stageRun] = [...queue.runs.values()];
  stageRun.status = 'success';
  stageRun.output = { summary: 'Specialist work done', evidence: [] };

  const afterService = createHermesTeamService(queue.plan, { wait: noWait });
  const after = new Mastra({
    workflows: {
      'agent-team': buildAgentTeamWorkflow(createHermesTeamAdapter(inProcessBridge(afterService))),
    },
    storage: storage(),
  });
  await restartActiveRuns(after);
  const stored = await after.getWorkflow('agent-team').getWorkflowRunById('team-event-restart');
  assert.equal(stored?.status, 'success');
  assert.equal(queue.runs.size, 1);
  assert.equal(queue.enqueued.length, 2);
  assert.equal(new Set(queue.enqueued).size, 1);
  assert.deepEqual(queue.canceled, []);
});
