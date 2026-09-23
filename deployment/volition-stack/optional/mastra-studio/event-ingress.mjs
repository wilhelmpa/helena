import { eventTriggerRegistry, workflowForEvent } from './src/mastra/triggers.ts';

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const ORGANIZATION_REF = /^organization:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROJECT_REF = /^project:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CAPABILITY_REF = /^[a-z][a-z0-9._-]{0,95}\.v[0-9]{1,6}$/;
const CONNECTION_REF = /^[a-z][a-z0-9._-]{0,63}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ACTOR_REF = /^(human|service|agent):([A-Za-z0-9][A-Za-z0-9._@+-]{0,190})$/;
const MAX_PAYLOAD_BYTES = 48 * 1024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 2000;
const MAX_COLLECTION_ITEMS = 256;
const MAX_OBJECT_KEYS = 128;
const MAX_STRING_BYTES = 8192;
const RESERVED_PAYLOAD_KEYS = new Set([
  'context',
  'eventId',
  'eventType',
  'organizationRef',
  'projectRef',
  'resourceId',
  'workflowId',
]);
const REQUIRED_KEYS = [
  'capabilityRefs',
  'connectionRefs',
  'dryRun',
  'eventId',
  'eventType',
  'organizationRef',
  'payload',
  'projectRef',
];
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, 'actorRef']);
const registryWorkflowIds = [...new Set(Object.values(eventTriggerRegistry))];

export class EventIngressError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'EventIngressError';
    this.status = status;
    this.code = code;
  }
}

function reject(code, message, status = 400) {
  throw new EventIngressError(status, code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateJson(value, state, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) reject('payload_too_complex', 'payload contains too many values');
  if (depth > MAX_JSON_DEPTH) reject('payload_too_deep', 'payload nesting is too deep');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject('invalid_payload', 'payload contains a non-finite number');
    return;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > MAX_STRING_BYTES)
      reject('payload_string_too_large', 'payload contains an oversized string');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS)
      reject('payload_collection_too_large', 'payload contains an oversized array');
    for (const item of value) validateJson(item, state, depth + 1);
    return;
  }
  if (!isPlainObject(value)) reject('invalid_payload', 'payload must contain JSON values only');
  const keys = Object.keys(value);
  if (keys.length > MAX_OBJECT_KEYS)
    reject('payload_collection_too_large', 'payload contains an oversized object');
  for (const key of keys) {
    if (
      !key ||
      Buffer.byteLength(key) > 128 ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      reject('invalid_payload_key', 'payload contains an invalid key');
    }
    validateJson(value[key], state, depth + 1);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function refs(value, pattern, name) {
  if (!Array.isArray(value) || value.length > 32)
    reject('invalid_refs', name + ' must be an array with at most 32 entries');
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string' || !pattern.test(item))
      reject('invalid_refs', name + ' contains an invalid reference');
    if (result.includes(item)) reject('duplicate_refs', name + ' contains a duplicate reference');
    result.push(item);
  }
  return result;
}

function actor(actorRef) {
  if (actorRef === undefined) return { type: 'service', id: 'event-ingress' };
  if (typeof actorRef !== 'string') reject('invalid_actor_ref', 'actorRef is invalid');
  const match = actorRef.match(ACTOR_REF);
  if (!match) reject('invalid_actor_ref', 'actorRef is invalid');
  return { type: match[1], id: match[2] };
}

function requiredCapabilities(catalog, workflowId) {
  const flow = catalog?.flows?.find(item => item?.id === workflowId);
  return Array.isArray(flow?.capabilityRefs) ? flow.capabilityRefs : [];
}

export function validateEventInput(raw, catalog) {
  if (!isPlainObject(raw)) reject('invalid_request', 'request body must be an object');
  const keys = Object.keys(raw);
  if (keys.some(key => !ALLOWED_KEYS.has(key)) || REQUIRED_KEYS.some(key => !(key in raw))) {
    reject('invalid_contract', 'request body does not match the event contract');
  }
  if (typeof raw.eventId !== 'string' || !EVENT_ID.test(raw.eventId))
    reject('invalid_event_id', 'eventId is invalid');
  if (typeof raw.eventType !== 'string' || raw.eventType.length > 100)
    reject('invalid_event_type', 'eventType is invalid');
  const workflowId = workflowForEvent(raw.eventType);
  if (!workflowId) reject('unknown_event', 'eventType is not registered', 422);
  if (typeof raw.organizationRef !== 'string' || !ORGANIZATION_REF.test(raw.organizationRef))
    reject('invalid_organization_ref', 'organizationRef is invalid');
  if (typeof raw.projectRef !== 'string' || !PROJECT_REF.test(raw.projectRef))
    reject('invalid_project_ref', 'projectRef is invalid');
  if (typeof raw.dryRun !== 'boolean') reject('invalid_dry_run', 'dryRun must be a boolean');
  if (!isPlainObject(raw.payload)) reject('invalid_payload', 'payload must be an object');
  for (const key of Object.keys(raw.payload)) {
    if (RESERVED_PAYLOAD_KEYS.has(key))
      reject('ambiguous_scope', 'payload.' + key + ' is reserved for the event envelope');
  }
  const projectKey = raw.projectRef.slice('project:'.length);
  if ('projectKey' in raw.payload && raw.payload.projectKey !== projectKey)
    reject('project_scope_mismatch', 'payload.projectKey does not match projectRef', 409);
  validateJson(raw.payload, { nodes: 0 });
  if (Buffer.byteLength(JSON.stringify(raw.payload)) > MAX_PAYLOAD_BYTES)
    reject('payload_too_large', 'payload is too large', 413);

  const capabilityRefs = refs(raw.capabilityRefs, CAPABILITY_REF, 'capabilityRefs');
  const connectionRefs = refs(raw.connectionRefs, CONNECTION_REF, 'connectionRefs');
  const missing = requiredCapabilities(catalog, workflowId).filter(ref => !capabilityRefs.includes(ref));
  if (missing.length)
    reject('missing_capability', 'the event does not grant every workflow capability', 403);

  return {
    eventId: raw.eventId,
    eventType: raw.eventType,
    workflowId,
    organizationRef: raw.organizationRef,
    projectRef: raw.projectRef,
    actor: actor(raw.actorRef),
    capabilityRefs,
    connectionRefs,
    payload: JSON.parse(JSON.stringify(raw.payload)),
    dryRun: raw.dryRun,
  };
}

function envelopeFor(input, occurredAt) {
  return {
    eventId: input.eventId,
    correlationId: input.eventId,
    occurredAt,
    source: 'private-event-ingress',
    actor: input.actor,
    context: {
      organizationRef: input.organizationRef,
      projectRef: input.projectRef,
      capabilityRefs: input.capabilityRefs,
      connectionRefs: input.connectionRefs,
    },
    dryRun: input.dryRun,
    payload: input.payload,
  };
}

function replayMatches(existing, input) {
  const envelope = existing?.payload;
  return (
    isPlainObject(envelope) &&
    envelope.eventId === input.eventId &&
    envelope.correlationId === input.eventId &&
    envelope.source === 'private-event-ingress' &&
    sameJson(envelope.actor, input.actor) &&
    sameJson(envelope.context, {
      organizationRef: input.organizationRef,
      projectRef: input.projectRef,
      capabilityRefs: input.capabilityRefs,
      connectionRefs: input.connectionRefs,
    }) &&
    envelope.dryRun === input.dryRun &&
    sameJson(envelope.payload, input.payload)
  );
}

function runStatus(run) {
  return run?.status ?? run?.snapshot?.status ?? 'unknown';
}

function responseFor(input, run, replayed) {
  return {
    eventId: input.eventId,
    eventType: input.eventType,
    workflowId: input.workflowId,
    projectRef: input.projectRef,
    runId: run?.runId ?? input.eventId,
    status: runStatus(run),
    replayed,
  };
}

export function createEventIngressService({
  catalog,
  lookupRun,
  startWorkflow,
  now = () => new Date(),
}) {
  if (typeof lookupRun !== 'function' || typeof startWorkflow !== 'function')
    throw new Error('lookupRun and startWorkflow are required');
  const inflight = new Map();

  async function executeOnce(input) {
    const found = (
      await Promise.all(
        registryWorkflowIds.map(async workflowId => ({
          workflowId,
          run: await lookupRun(workflowId, input.eventId),
        })),
      )
    ).filter(item => item.run);

    if (found.length > 1) reject('idempotency_conflict', 'eventId resolves to multiple runs', 409);
    if (found.length === 1) {
      const existing = found[0];
      if (
        existing.workflowId !== input.workflowId ||
        existing.run.resourceId !== input.projectRef ||
        !replayMatches(existing.run, input)
      ) {
        reject('idempotency_conflict', 'eventId is already in use by another event scope', 409);
      }
      return responseFor(input, existing.run, true);
    }

    const envelope = envelopeFor(input, now().toISOString());
    const run = await startWorkflow({
      workflowId: input.workflowId,
      eventId: input.eventId,
      projectRef: input.projectRef,
      envelope,
    });
    return responseFor(input, run, false);
  }

  return {
    async execute(raw) {
      const input = validateEventInput(raw, catalog);
      const fingerprint = JSON.stringify(stableValue(input));
      const current = inflight.get(input.eventId);
      if (current) {
        if (current.fingerprint !== fingerprint)
          reject('idempotency_conflict', 'eventId is already in use by another event scope', 409);
        return current.promise;
      }
      const promise = executeOnce(input);
      inflight.set(input.eventId, { fingerprint, promise });
      try {
        return await promise;
      } finally {
        if (inflight.get(input.eventId)?.promise === promise) inflight.delete(input.eventId);
      }
    },
  };
}
