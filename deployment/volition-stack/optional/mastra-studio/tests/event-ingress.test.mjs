import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createEventIngressService,
  EventIngressError,
  validateEventInput,
} from '../event-ingress.mjs';

const catalog = JSON.parse(
  await readFile(new URL('../catalog/flows.json', import.meta.url), 'utf8'),
);

function event(patch = {}) {
  return {
    eventId: 'event-001',
    eventType: 'system.audit.requested',
    organizationRef: 'organization:volition',
    projectRef: 'project:PRIV',
    actorRef: 'service:plan-shadow',
    capabilityRefs: [],
    connectionRefs: [],
    payload: { projectKey: 'PRIV', mode: 'shadow' },
    dryRun: true,
    ...patch,
  };
}

function error(code, status) {
  return value =>
    value instanceof EventIngressError && value.code === code && value.status === status;
}

test('contract resolves the existing trigger registry and builds a bounded scope', () => {
  const value = validateEventInput(event(), catalog);
  assert.equal(value.workflowId, 'system-audit');
  assert.deepEqual(value.actor, { type: 'service', id: 'plan-shadow' });
  assert.equal(value.projectRef, 'project:PRIV');

  const defaultActor = validateEventInput(event({ actorRef: undefined }), catalog);
  assert.deepEqual(defaultActor.actor, { type: 'service', id: 'event-ingress' });
});

test('contract rejects unknown events, ambiguous scope and missing capabilities', () => {
  for (const eventType of ['unknown.event', '__proto__', 'constructor', 'toString']) {
    assert.throws(
      () => validateEventInput(event({ eventType }), catalog),
      error('unknown_event', 422),
    );
  }
  assert.throws(
    () => validateEventInput(event({ payload: { projectKey: 'OTHER' } }), catalog),
    error('project_scope_mismatch', 409),
  );
  assert.throws(
    () => validateEventInput(event({ payload: { projectRef: 'project:OTHER' } }), catalog),
    error('ambiguous_scope', 400),
  );
  assert.throws(
    () =>
      validateEventInput(
        event({
          eventType: 'document.received',
          capabilityRefs: [],
          payload: { projectKey: 'PRIV' },
        }),
        catalog,
      ),
    error('missing_capability', 403),
  );
  assert.equal(
    validateEventInput(
      event({
        eventType: 'document.received',
        capabilityRefs: ['document-store.v1'],
      }),
      catalog,
    ).workflowId,
    'document-filing',
  );
});

test('contract enforces exact keys, unique refs and payload limits', () => {
  assert.throws(
    () => validateEventInput({ ...event(), extra: true }, catalog),
    error('invalid_contract', 400),
  );
  assert.throws(
    () =>
      validateEventInput(
        event({ connectionRefs: ['vault:primary', 'vault:primary'] }),
        catalog,
      ),
    error('duplicate_refs', 400),
  );
  assert.throws(
    () => validateEventInput(event({ payload: { value: 'x'.repeat(8193) } }), catalog),
    error('payload_string_too_large', 400),
  );
});

test('parallel duplicate delivery starts one Mastra run', async () => {
  let starts = 0;
  let stored = null;
  const service = createEventIngressService({
    catalog,
    lookupRun: async (workflowId, eventId) =>
      stored?.workflowName === workflowId && stored.runId === eventId ? stored : null,
    startWorkflow: async ({ workflowId, eventId, projectRef, envelope }) => {
      starts += 1;
      await new Promise(resolve => setImmediate(resolve));
      stored = {
        workflowName: workflowId,
        runId: eventId,
        resourceId: projectRef,
        status: 'success',
        payload: envelope,
      };
      return stored;
    },
    now: () => new Date('2026-09-22T10:00:00.000Z'),
  });

  const [first, duplicate] = await Promise.all([
    service.execute(event()),
    service.execute(event()),
  ]);
  assert.equal(starts, 1);
  assert.equal(first.runId, 'event-001');
  assert.equal(duplicate.runId, 'event-001');
  assert.equal(first.replayed, false);
  assert.equal(duplicate.replayed, false);

  const replay = await service.execute(event());
  assert.equal(starts, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.status, 'success');
});

test('persistent idempotency rejects a changed project, payload or event type', async () => {
  const original = event();
  const normalized = validateEventInput(original, catalog);
  const existing = {
    workflowName: normalized.workflowId,
    runId: normalized.eventId,
    resourceId: normalized.projectRef,
    status: 'success',
    payload: {
      eventId: normalized.eventId,
      correlationId: normalized.eventId,
      occurredAt: '2026-09-22T10:00:00.000Z',
      source: 'private-event-ingress',
      actor: normalized.actor,
      context: {
        organizationRef: normalized.organizationRef,
        projectRef: normalized.projectRef,
        capabilityRefs: normalized.capabilityRefs,
        connectionRefs: normalized.connectionRefs,
      },
      dryRun: normalized.dryRun,
      payload: normalized.payload,
    },
  };
  const service = createEventIngressService({
    catalog,
    lookupRun: async (workflowId, eventId) =>
      workflowId === existing.workflowName && eventId === existing.runId ? existing : null,
    startWorkflow: async () => {
      throw new Error('must not start');
    },
  });

  assert.equal((await service.execute(original)).replayed, true);
  await assert.rejects(
    () =>
      service.execute(
        event({
          organizationRef: 'organization:other',
          projectRef: 'project:OTHER',
          payload: { projectKey: 'OTHER', mode: 'shadow' },
        }),
      ),
    error('idempotency_conflict', 409),
  );
  await assert.rejects(
    () => service.execute(event({ payload: { projectKey: 'PRIV', mode: 'changed' } })),
    error('idempotency_conflict', 409),
  );
  await assert.rejects(
    () => service.execute(event({ eventType: 'career.job.discovered' })),
    error('idempotency_conflict', 409),
  );
});
