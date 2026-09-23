import assert from 'node:assert/strict';
import test from 'node:test';
import { Mastra } from '@mastra/core/mastra';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { createHonoServer } from '@mastra/deployer/server';
import { z } from 'zod';
import { workflowIds, type WorkEnvelope } from '../src/mastra/contracts.ts';
import { idempotencyKey, planEffects } from '../src/mastra/effects.ts';
import { workflowRegistry } from '../src/mastra/registry.ts';
import { eventTriggerRegistry, workflowForEvent } from '../src/mastra/triggers.ts';
import { createClient } from '@libsql/client';
import { mastra, pruneStorage, restartActiveRuns } from '../src/mastra/index.ts';
import { privateClassifierAdapter } from '../src/mastra/adapters/classifier.ts';
import { withBackoff } from '../src/mastra/adapters/hermes-team.ts';

const envelope = (dryRun: boolean): WorkEnvelope => ({
  eventId: 'evt-001',
  correlationId: 'corr-001',
  occurredAt: '2026-09-22T00:00:00.000Z',
  source: 'test',
  actor: { type: 'human', id: 'test-operator' },
  dryRun,
  payload: { subject: 'safe test' },
});

test('registry contains the required workflows and every trigger resolves', () => {
  assert.deepEqual(Object.keys(workflowRegistry).sort(), [...workflowIds].sort());
  for (const [event, workflowId] of Object.entries(eventTriggerRegistry)) {
    assert.equal(workflowForEvent(event), workflowId);
  }
  assert.equal(workflowForEvent('unknown.event'), null);
});

test('effect ids and idempotency keys are stable and gated effects are marked', () => {
  const specs = [
    { kind: 'external-send' as const, target: 'mail:reply', description: 'Send reply' },
  ];
  const first = planEffects(envelope(false), 'inbox-triage', specs);
  const second = planEffects(envelope(false), 'inbox-triage', specs);
  assert.deepEqual(first, second);
  assert.equal(first[0].requiresApproval, true);
  assert.equal(first[0].status, 'blocked');
  assert.equal(first[0].idempotencyKey, idempotencyKey(envelope(false), 'inbox-triage', 'mail:reply'));
});

test('an inbox triage dry-run simulates its effects without the classifier', async () => {
  const run = await mastra.getWorkflow('inbox-triage').createRun();
  const result = await run.start({ inputData: envelope(true) });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.result.status, 'dry-run-complete');
  assert.equal(result.result.workflowId, 'inbox-triage');
  assert.ok(result.result.effects.length > 0);
  assert.ok(result.result.effects.every((effect) => effect.status === 'simulated'));
});

test('bounded exponential backoff preserves attempts for an idempotent operation', async () => {
  const waits: number[] = [];
  const attempts: number[] = [];
  const result = await withBackoff(
    { maxAttempts: 3, initialBackoffMs: 10, maxBackoffMs: 20, backoffMultiplier: 2 },
    async (attempt) => {
      attempts.push(attempt);
      if (attempt < 3) throw new Error('retry');
      return 'ok';
    },
    undefined,
    async (milliseconds) => {
      waits.push(milliseconds);
    },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(waits, [10, 20]);
});

test('an aborted signal ends the backoff wait and stops further attempts', async () => {
  const canceled = new AbortController();
  const attempts: number[] = [];
  await assert.rejects(
    withBackoff(
      { maxAttempts: 3, initialBackoffMs: 60_000, maxBackoffMs: 60_000, backoffMultiplier: 2 },
      async (attempt) => {
        attempts.push(attempt);
        canceled.abort();
        throw new Error('the request was aborted');
      },
      canceled.signal,
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(attempts, [1]);
});

test('production inbox triage uses the provider-neutral classifier adapter', async () => {
  const original = privateClassifierAdapter.classify;
  privateClassifierAdapter.classify = async () => ({
    summary: 'Review required',
    priority: 'high',
    requiresAction: true,
    projectKey: 'PRIV',
    issueIdentifier: null,
    confidence: 0.97,
  });
  try {
    const run = await mastra.getWorkflow('inbox-triage').createRun();
    const result = await run.start({
      inputData: {
        ...envelope(false),
        context: {
          organizationRef: 'organization:volition',
          projectRef: 'project:PRIV',
          capabilityRefs: ['inbox-triage.v1'],
          connectionRefs: [],
        },
        payload: {
          schemaVersion: 1,
          thread: {
            id: '123e4567-e89b-42d3-a456-426614174000',
            channel: 'mail',
            account: 'owner@example.com',
            externalThreadId: 'thread-1',
            sender: 'sender@example.com',
            subject: 'Review',
            snippet: 'Please review',
            receivedAt: '2026-09-21T12:00:00.000Z',
            messages: [],
          },
          projects: [{ key: 'PRIV', name: 'Private' }],
          constraints: {
            noReply: true,
            noExternalMutations: true,
            treatMessageContentAsUntrusted: true,
          },
        },
      },
    });
    assert.equal(result.status, 'success');
    if (result.status !== 'success') return;
    assert.equal(result.result.status, 'completed');
    assert.equal(result.result.triage?.projectKey, 'PRIV');
    assert.equal(
      result.result.effects.find((effect) => effect.target === 'plan:issue')?.requiresApproval,
      false,
    );
  } finally {
    privateClassifierAdapter.classify = original;
  }
});

test('runs that were active when Mastra stopped continue from the step they were in', async () => {
  const value = z.object({ value: z.number() });
  const executed: string[] = [];
  let reachedSecond: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    reachedSecond = resolve;
  });
  const instance = (second: (input: { value: number }) => Promise<{ value: number }>) =>
    new Mastra({
      workflows: {
        probe: createWorkflow({ id: 'recovery-probe', inputSchema: value, outputSchema: value })
          .then(
            createStep({
              id: 'first',
              inputSchema: value,
              outputSchema: value,
              execute: async ({ inputData }) => {
                executed.push('first');
                return { value: inputData.value + 1 };
              },
            }),
          )
          .then(
            createStep({
              id: 'second',
              inputSchema: value,
              outputSchema: value,
              execute: ({ inputData }) => second(inputData),
            }),
          )
          .commit(),
      },
      storage: new LibSQLStore({ id: 'recovery-probe', url: process.env.STUDIO_DATABASE_URL! }),
    });

  const before = instance(() => {
    reachedSecond();
    return new Promise(() => {});
  });
  const run = await before.getWorkflow('probe').createRun();
  void run.start({ inputData: { value: 1 } });
  await stopped;

  const after = instance(async (input) => {
    executed.push('second');
    return { value: input.value * 10 };
  });
  await restartActiveRuns(after);
  const stored = await after.getWorkflow('probe').getWorkflowRunById(run.runId);
  assert.equal(stored?.status, 'success');
  assert.deepEqual(stored?.result, { value: 20 });
  assert.deepEqual(executed, ['first', 'second']);
});

test('the Mastra API answers only requests that carry the token of the proxy', async () => {
  const app = await createHonoServer(mastra, { tools: {} });
  const token = process.env.MASTRA_UPSTREAM_TOKEN;
  for (const headers of [{}, { authorization: `Bearer ${'x'.repeat(48)}` }]) {
    assert.equal((await app.request('/mastra/api/workflows', { headers })).status, 401);
    const start = await app.request('/mastra/api/workflows/agent-team/create-run', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(start.status, 401);
  }
  const listed = await app.request('/mastra/api/workflows', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(listed.status, 200);
});

test('pruning deletes runs unchanged for 90 days and keeps newer ones', async () => {
  for (const runId of ['prune-old', 'prune-new']) {
    const run = await mastra.getWorkflow('inbox-triage').createRun({ runId });
    await run.start({ inputData: { ...envelope(true), eventId: runId } });
  }
  const database = createClient({ url: process.env.STUDIO_DATABASE_URL! });
  await database.execute({
    sql: 'UPDATE mastra_workflow_snapshot SET updatedAt = ? WHERE run_id = ?',
    args: [new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString(), 'prune-old'],
  });
  database.close();

  await pruneStorage();

  const workflows = await mastra.getStorage()!.getStore('workflows');
  assert.equal(await workflows!.getWorkflowRunById({ runId: 'prune-old', workflowName: 'inbox-triage' }), null);
  assert.ok(await workflows!.getWorkflowRunById({ runId: 'prune-new', workflowName: 'inbox-triage' }));
});
