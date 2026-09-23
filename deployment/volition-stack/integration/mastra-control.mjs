const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SCHEDULE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const PROJECT_REF = /^project:[A-Za-z0-9._-]+$/;
const ORGANIZATION_REF = /^organization:[A-Za-z0-9._-]+$/;
const CAPABILITY_REF = /^[a-z][a-z0-9._-]*\.v\d+$/;
const CONNECTION_REF = /^[a-z][a-z0-9._-]*:[A-Za-z0-9._-]+$/;
const SCHEDULE_KEY = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const TERMINAL_STATUSES = new Set(['success', 'failed', 'canceled', 'bailed', 'skipped']);

export class MastraControlError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MastraControlError';
    this.status = status;
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MastraControlError(400, `${label} is invalid`);
  }
  return value;
}

function string(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new MastraControlError(400, `${label} is invalid`);
  }
  return value;
}

function refs(values, pattern, label) {
  if (!Array.isArray(values) || values.length > 32 || values.some((value) => typeof value !== 'string' || !pattern.test(value))) {
    throw new MastraControlError(400, `${label} is invalid`);
  }
  return [...new Set(values)];
}

function page(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new MastraControlError(400, 'Pagination is invalid');
  }
  return value;
}

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new MastraControlError(400, 'occurredAt is invalid');
  }
  return new Date(value).toISOString();
}

function cron(value) {
  if (typeof value !== 'string' || value.length < 5 || value.length > 120 || !/^[0-9A-Za-z*/?,#LW\-\s]+$/.test(value)) {
    throw new MastraControlError(400, 'cron is invalid');
  }
  return value.trim().replace(/\s+/g, ' ');
}

function timezone(value) {
  if (typeof value !== 'string' || value.length > 80) throw new MastraControlError(400, 'timezone is invalid');
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
  } catch {
    throw new MastraControlError(400, 'timezone is invalid');
  }
  return value;
}

async function responseJson(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new MastraControlError(502, 'Mastra response is too large');
  let value;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    throw new MastraControlError(502, 'Mastra returned an invalid response');
  }
  if (!response.ok) {
    const status = response.status === 404 ? 404 : response.status === 409 ? 409 : response.status < 500 ? 400 : 502;
    throw new MastraControlError(status, 'Mastra rejected the control request');
  }
  return value;
}

export function createMastraControlService(config, options = {}) {
  const request = options.fetch ?? fetch;
  const base = new URL(config.mastraControlUrl);
  const pendingScheduleCreates = new Map();

  async function call(path, init = {}) {
    const response = await request(new URL(path, base), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(330_000),
      headers: {
        accept: 'application/json',
        'x-volition-auth': 'verified',
        'x-auth-request-email': config.mastraControlOwnerEmail,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    }).catch(() => {
      throw new MastraControlError(502, 'Mastra control plane is unavailable');
    });
    return responseJson(response);
  }

  async function ownedRun(workflowId, runId, projectRef) {
    const run = object(await call(`workflows/${workflowId}/runs/${runId}`), 'Mastra run');
    if (run.resourceId !== projectRef) throw new MastraControlError(404, 'Workflow run not found');
    return run;
  }

  async function ownedSchedule(scheduleId, projectRef) {
    const schedule = object(await call(`schedules/${scheduleId}`), 'Mastra schedule');
    if (schedule.workflowId == null || schedule.requestContext?.projectRef !== projectRef) {
      throw new MastraControlError(404, 'Workflow schedule not found');
    }
    return schedule;
  }

  return {
    // Removes the project's workflow schedules when the project is deleted.
    async deleteProjectSchedules(projectRef) {
      string(projectRef, PROJECT_REF, 'projectRef');
      const result = object(await call('schedules'), 'Mastra schedules');
      const owned = Array.isArray(result.schedules)
        ? result.schedules.filter((item) => item?.workflowId != null && item.requestContext?.projectRef === projectRef)
        : [];
      for (const schedule of owned) {
        const scheduleId = string(schedule.id, SCHEDULE_ID, 'scheduleId');
        await call(`schedules/${scheduleId}`, { method: 'DELETE' }).catch((error) => {
          if (!(error instanceof MastraControlError && error.status === 404)) throw error;
        });
      }
      return owned.length;
    },

    async execute(raw) {
      const input = object(raw, 'Control request');
      if (input.schemaVersion !== 1 || typeof input.operation !== 'string') {
        throw new MastraControlError(400, 'Control request is invalid');
      }
      if (input.operation === 'catalog') {
        return { catalog: await call('control-plane-catalog') };
      }

      const workflowId = string(input.workflowId, WORKFLOW_ID, 'workflowId');
      const projectRef = string(input.projectRef, PROJECT_REF, 'projectRef');

      if (input.operation === 'runs') {
        const currentPage = page(input.page, 0, 10_000);
        const pageSize = page(input.pageSize, 20, 100);
        const result = object(await call(`workflows/${workflowId}/runs?resourceId=${projectRef}&page=${currentPage}&perPage=${pageSize}`), 'Mastra runs');
        return {
          ...result,
          runs: Array.isArray(result.runs)
            ? result.runs.map((run) => ({
                ...run,
                status: run?.status ?? run?.snapshot?.status ?? 'unknown',
              }))
            : [],
        };
      }
      if (input.operation === 'run') {
        return ownedRun(workflowId, string(input.runId, RUN_ID, 'runId'), projectRef);
      }
      if (input.operation === 'start') {
        const eventId = string(input.eventId, RUN_ID, 'eventId');
        const existing = await call(`workflows/${workflowId}/runs/${eventId}`).catch((error) => {
          if (error instanceof MastraControlError && error.status === 404) return null;
          throw error;
        });
        if (existing) {
          if (existing.resourceId !== projectRef) throw new MastraControlError(409, 'Idempotency key is already in use');
          return existing;
        }
        const organizationRef = string(input.organizationRef, ORGANIZATION_REF, 'organizationRef');
        const capabilityRefs = refs(input.capabilityRefs, CAPABILITY_REF, 'capabilityRefs');
        const connectionRefs = refs(input.connectionRefs, CONNECTION_REF, 'connectionRefs');
        const envelope = {
          eventId,
          correlationId: typeof input.correlationId === 'string' && input.correlationId.length <= 200 ? input.correlationId : eventId,
          occurredAt: timestamp(input.occurredAt),
          source: 'itsaplan-ui',
          actor: { type: 'human', id: string(input.actorId, /^[A-Za-z0-9._:@-]{1,200}$/, 'actorId') },
          context: { organizationRef, projectRef, capabilityRefs, connectionRefs },
          dryRun: input.dryRun === true,
          payload: object(input.payload, 'payload'),
        };
        return call(`workflows/${workflowId}/start-async?runId=${encodeURIComponent(eventId)}`, {
          method: 'POST',
          body: JSON.stringify({
            inputData: envelope,
            resourceId: projectRef,
            requestContext: envelope.context,
          }),
        });
      }

      if (input.operation === 'schedules') {
        const result = object(await call(`schedules?workflowId=${workflowId}`), 'Mastra schedules');
        return { schedules: Array.isArray(result.schedules) ? result.schedules.filter((item) => item?.requestContext?.projectRef === projectRef) : [] };
      }
      if (input.operation === 'create-schedule') {
        const organizationRef = string(input.organizationRef, ORGANIZATION_REF, 'organizationRef');
        const capabilityRefs = refs(input.capabilityRefs, CAPABILITY_REF, 'capabilityRefs');
        const connectionRefs = refs(input.connectionRefs, CONNECTION_REF, 'connectionRefs');
        const scheduleKey = input.scheduleKey === undefined
          ? 'default'
          : string(input.scheduleKey, SCHEDULE_KEY, 'scheduleKey');
        const createKey = `${workflowId}\0${projectRef}\0${scheduleKey}`;
        const current = pendingScheduleCreates.get(createKey);
        if (current) return current;
        const pending = (async () => {
          const existingResult = object(await call(`schedules?workflowId=${workflowId}`), 'Mastra schedules');
          const existing = Array.isArray(existingResult.schedules)
            ? existingResult.schedules.find(item =>
                item?.requestContext?.projectRef === projectRef &&
                item?.metadata?.scheduleKey === scheduleKey)
            : null;
          if (existing) return { ...existing, replayed: true };
          return call('schedules', {
            method: 'POST',
            body: JSON.stringify({
              workflowId,
              cron: cron(input.cron),
              timezone: timezone(input.timezone),
              inputData: object(input.payload, 'payload'),
              requestContext: { organizationRef, projectRef, capabilityRefs, connectionRefs },
              metadata: {
                projectRef,
                source: 'itsaplan',
                scheduleKey,
                missedRunPolicy: input.missedRunPolicy === 'run-once' ? 'run-once' : 'skip',
                concurrencyPolicy: input.concurrencyPolicy === 'replace' ? 'replace' : 'forbid',
              },
            }),
          });
        })();
        pendingScheduleCreates.set(createKey, pending);
        try {
          return await pending;
        } finally {
          if (pendingScheduleCreates.get(createKey) === pending) pendingScheduleCreates.delete(createKey);
        }
      }
      if (input.operation.includes('schedule')) {
        const scheduleId = string(input.scheduleId, SCHEDULE_ID, 'scheduleId');
        await ownedSchedule(scheduleId, projectRef);
        if (input.operation === 'schedule-triggers') {
          return call(`schedules/${scheduleId}/triggers?limit=${page(input.limit, 20, 100)}`);
        }
        if (input.operation === 'update-schedule') {
          return call(`schedules/${scheduleId}`, {
            method: 'PATCH',
            body: JSON.stringify({ cron: cron(input.cron), timezone: timezone(input.timezone) }),
          });
        }
        if (input.operation === 'pause-schedule' || input.operation === 'resume-schedule' || input.operation === 'run-schedule') {
          const action = input.operation.replace('-schedule', '');
          return call(`schedules/${scheduleId}/${action}`, { method: 'POST' });
        }
        if (input.operation === 'delete-schedule') {
          return call(`schedules/${scheduleId}`, { method: 'DELETE' });
        }
        throw new MastraControlError(400, 'Control operation is invalid');
      }

      const runId = string(input.runId, RUN_ID, 'runId');
      const run = await ownedRun(workflowId, runId, projectRef);
      if (input.operation === 'resume') {
        if (run.status !== 'suspended') throw new MastraControlError(409, 'Workflow run is not awaiting approval');
        if (typeof input.approved !== 'boolean') throw new MastraControlError(400, 'Approval decision is required');
        const note = input.note === undefined ? undefined : String(input.note);
        if (note !== undefined && note.length > 2000) throw new MastraControlError(400, 'Approval note is too long');
        return call(`workflows/${workflowId}/resume-async?runId=${encodeURIComponent(runId)}`, {
          method: 'POST',
          body: JSON.stringify({
            step: 'approval-gate',
            resumeData: {
              approved: input.approved,
              decidedBy: string(input.decidedBy, /^[A-Za-z0-9._:@-]{1,200}$/, 'decidedBy'),
              ...(note ? { note } : {}),
            },
            requestContext: { projectRef },
          }),
        });
      }
      if (input.operation === 'cancel') {
        if (TERMINAL_STATUSES.has(run.status)) throw new MastraControlError(409, 'Workflow run is already terminal');
        return call(`workflows/${workflowId}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
      }
      if (input.operation === 'retry') {
        if (run.status !== 'failed') throw new MastraControlError(409, 'Only failed workflow runs can be retried');
        return call(`workflows/${workflowId}/restart-async?runId=${encodeURIComponent(runId)}`, {
          method: 'POST',
          body: JSON.stringify({ requestContext: { projectRef } }),
        });
      }
      throw new MastraControlError(400, 'Control operation is invalid');
    },
  };
}
