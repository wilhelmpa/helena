import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowIds, type WorkEnvelope } from '../src/mastra/contracts.ts';
import { idempotencyKey, planEffects } from '../src/mastra/effects.ts';
import { workflowDefinitions, workflowRegistry } from '../src/mastra/registry.ts';
import { eventTriggerRegistry, workflowForEvent } from '../src/mastra/triggers.ts';
import { mastra } from '../src/mastra/index.ts';

const envelope = (dryRun: boolean): WorkEnvelope => ({
  eventId: 'evt-001',
  correlationId: 'corr-001',
  occurredAt: '2026-09-22T00:00:00.000Z',
  source: 'test',
  actor: { type: 'human', id: 'test-operator' },
  dryRun,
  payload: { subject: 'safe test' },
});

test('registry contains the six required workflows and every trigger resolves', () => {
  assert.deepEqual(Object.keys(workflowRegistry).sort(), [...workflowIds].sort());
  assert.deepEqual(workflowDefinitions.map(item => item.id).sort(), [...workflowIds].sort());
  for (const [event, workflowId] of Object.entries(eventTriggerRegistry)) {
    assert.equal(workflowForEvent(event), workflowId);
  }
  assert.equal(workflowForEvent('unknown.event'), null);
});

test('effect ids and idempotency keys are stable and gated effects are marked', () => {
  const specs = [{ kind: 'external-send' as const, target: 'mail:reply', description: 'Send reply' }];
  const first = planEffects(envelope(false), 'support', specs);
  const second = planEffects(envelope(false), 'support', specs);
  assert.deepEqual(first, second);
  assert.equal(first[0].requiresApproval, true);
  assert.equal(first[0].status, 'blocked');
  assert.equal(first[0].idempotencyKey, idempotencyKey(envelope(false), 'support', 'mail:reply'));
});

test('all workflows execute a safe dry-run', async () => {
  for (const workflowId of workflowIds) {
    const run = await mastra.getWorkflow(workflowId).createRun();
    const result = await run.start({ inputData: envelope(true) });
    assert.equal(result.status, 'success', workflowId);
    if (result.status !== 'success') continue;
    assert.equal(result.result.status, 'dry-run-complete');
    assert.equal(result.result.workflowId, workflowId);
    assert.ok(result.result.effects.length > 0);
    assert.ok(result.result.effects.every(effect => effect.status === 'simulated'));
  }
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
