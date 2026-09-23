import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowIds, type WorkEnvelope } from '../src/mastra/contracts.ts';
import { idempotencyKey, planEffects } from '../src/mastra/effects.ts';
import { workflowDefinitions, workflowRegistry } from '../src/mastra/registry.ts';
import { eventTriggerRegistry, workflowForEvent } from '../src/mastra/triggers.ts';
import { mastra } from '../src/mastra/index.ts';
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
  assert.deepEqual(
    [...workflowDefinitions.map((item) => item.id), 'agent-team'].sort(),
    [...workflowIds].sort(),
  );
  for (const [event, workflowId] of Object.entries(eventTriggerRegistry)) {
    assert.equal(workflowForEvent(event), workflowId);
  }
  assert.equal(workflowForEvent('unknown.event'), null);
});

test('effect ids and idempotency keys are stable and gated effects are marked', () => {
  const specs = [
    { kind: 'external-send' as const, target: 'mail:reply', description: 'Send reply' },
  ];
  const first = planEffects(envelope(false), 'support', specs);
  const second = planEffects(envelope(false), 'support', specs);
  assert.deepEqual(first, second);
  assert.equal(first[0].requiresApproval, true);
  assert.equal(first[0].status, 'blocked');
  assert.equal(first[0].idempotencyKey, idempotencyKey(envelope(false), 'support', 'mail:reply'));
});

test('all workflows execute a safe dry-run', async () => {
  for (const workflowId of workflowIds.filter((item) => item !== 'agent-team')) {
    const run = await mastra.getWorkflow(workflowId).createRun();
    const result = await run.start({ inputData: envelope(true) });
    assert.equal(result.status, 'success', workflowId);
    if (result.status !== 'success') continue;
    assert.equal(result.result.status, 'dry-run-complete');
    assert.equal(result.result.workflowId, workflowId);
    assert.ok(result.result.effects.length > 0);
    assert.ok(result.result.effects.every((effect) => effect.status === 'simulated'));
  }
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

test('external effects suspend, then resume without executing them', async () => {
  const run = await mastra.getWorkflow('application').createRun();
  const suspended = await run.start({ inputData: envelope(false) });
  assert.equal(suspended.status, 'suspended');
  if (suspended.status !== 'suspended') return;
  assert.deepEqual(suspended.suspended[0], ['approval-gate']);
  const resumed = await run.resume({
    step: 'approval-gate',
    resumeData: { approved: true, decidedBy: 'test-operator' },
  });
  assert.equal(resumed.status, 'success');
  if (resumed.status !== 'success') return;
  assert.equal(resumed.result.status, 'needs-attention');
  assert.match(resumed.result.summary, /No external effect was executed/);
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
