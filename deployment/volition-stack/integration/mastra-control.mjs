const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SCHEDULE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const PROJECT_REF = /^project:[A-Za-z0-9._-]+$/;
const ORGANIZATION_REF = /^organization:[A-Za-z0-9._-]+$/;
const CAPABILITY_REF = /^[a-z][a-z0-9._-]*\.v\d+$/;
const CONNECTION_REF = /^[a-z][a-z0-9._-]*:[A-Za-z0-9._-]+$/;
const SCHEDULE_KEY = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const TASK_REF = /^task:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Mastra cannot filter runs by their payload, so a task's runs are searched among
// this many of the project's newest runs, 20 per request to stay below the response
// size limit.
const TASK_RUN_PAGES = 10;
const TASK_RUN_PAGE_SIZE = 20;
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

// A schedule list covers at most this many projects of one member.
const MAX_SCHEDULE_PROJECTS = 1_000;

function projectRefs(values) {
  if (!Array.isArray(values) || values.length > MAX_SCHEDULE_PROJECTS || values.some((value) => typeof value !== 'string' || !PROJECT_REF.test(value))) {
    throw new MastraControlError(400, 'projectRefs is invalid');
  }
  return new Set(values);
}

// The evented engine, which runs schedule fires, stores the result record of the last
// step as the run result; the default engine stores the output itself.
function runOutput(result) {
  return result && typeof result === 'object' && result.status === 'success' && 'output' in result ? result.output : result;
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

// Plan's control operations on the Mastra API at `mastraApiUrl`, which accepts only
// `mastraApiToken`. `catalog` is the workflow catalog the `catalog` operation answers.
export function createMastraControlService(config, options = {}) {
  const request = options.fetch ?? fetch;
  const base = new URL(config.mastraApiUrl);
  const pendingScheduleCreates = new Map();

  async function call(path, init = {}) {
    const response = await request(new URL(path, base), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(330_000),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${config.mastraApiToken}`,
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

  // The newest fire of a schedule, a manual one included, with the output of its run.
  // Mastra's own lastRunId names the newest cron fire only.
  async function withLastRun(workflowId, schedule) {
    if (typeof schedule?.id !== 'string' || !SCHEDULE_ID.test(schedule.id)) return schedule;
    const { triggers } = object(await call(`schedules/${schedule.id}/triggers?limit=1`), 'Mastra schedule triggers');
    const trigger = Array.isArray(triggers) ? triggers[0] : null;
    if (typeof trigger?.runId !== 'string' || !RUN_ID.test(trigger.runId)) return { ...schedule, lastRun: null };
    const run = await call(`workflows/${workflowId}/runs/${trigger.runId}?fields=result,error`).catch((error) => {
      if (error instanceof MastraControlError && error.status === 404) return null;
      throw error;
    });
    const runError = typeof run?.error === 'string' ? run.error : run?.error?.message;
    return {
      ...schedule,
      lastRun: {
        runId: trigger.runId,
        firedAt: trigger.actualFireAt ?? null,
        status: run?.status ?? (trigger.outcome === 'failed' ? 'failed' : 'pending'),
        result: runOutput(run?.result) ?? null,
        error: trigger.error ?? runError ?? null,
      },
    };
  }

  async function ownedSchedule(workflowId, scheduleId, projectRef) {
    const schedule = object(await call(`schedules/${scheduleId}`), 'Mastra schedule');
    if (schedule.workflowId !== workflowId || schedule.requestContext?.projectRef !== projectRef) {
      throw new MastraControlError(404, 'Workflow schedule not found');
    }
    return schedule;
  }

  // The schedules of every workflow of a deleted project.
  async function deleteProjectSchedules(projectRef) {
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
  }

  return {
    async execute(raw) {
      const input = object(raw, 'Control request');
      if (input.schemaVersion !== 1 || typeof input.operation !== 'string') {
        throw new MastraControlError(400, 'Control request is invalid');
      }
      if (input.operation === 'catalog') {
        return { catalog: config.catalog };
      }
      if (input.operation === 'delete-project-schedules') {
        return { deleted: await deleteProjectSchedules(string(input.projectRef, PROJECT_REF, 'projectRef')) };
      }

      const workflowId = string(input.workflowId, WORKFLOW_ID, 'workflowId');
      if (input.operation === 'schedules') {
        const projects = input.projectRefs === undefined
          ? new Set([string(input.projectRef, PROJECT_REF, 'projectRef')])
          : projectRefs(input.projectRefs);
        const result = object(await call(`schedules?workflowId=${workflowId}`), 'Mastra schedules');
        const owned = Array.isArray(result.schedules)
          ? result.schedules.filter((item) => projects.has(item?.requestContext?.projectRef))
          : [];
        return { schedules: await Promise.all(owned.map((schedule) => withLastRun(workflowId, schedule))) };
      }
      const projectRef = string(input.projectRef, PROJECT_REF, 'projectRef');

      if (input.operation === 'runs') {
        // A project keeps its assignment of a workflow that left the catalog.
        if (!config.catalog.flows.some((flow) => flow.id === workflowId)) return { runs: [], total: 0 };
        const currentPage = page(input.page, 0, 10_000);
        const pageSize = page(input.pageSize, 20, 100);
        const withStatus = (run) => ({
          ...run,
          status: run?.status ?? run?.snapshot?.status ?? 'unknown',
          ...(run?.snapshot ? { snapshot: { ...run.snapshot, result: runOutput(run.snapshot.result) } } : {}),
        });
        if (input.taskRef !== undefined) {
          const taskRef = string(input.taskRef, TASK_REF, 'taskRef');
          const matches = [];
          for (let scan = 0; scan < TASK_RUN_PAGES; scan += 1) {
            const result = object(await call(`workflows/${workflowId}/runs?resourceId=${projectRef}&page=${scan}&perPage=${TASK_RUN_PAGE_SIZE}`), 'Mastra runs');
            const runs = Array.isArray(result.runs) ? result.runs : [];
            matches.push(...runs.filter((run) => run?.snapshot?.context?.input?.payload?.task?.taskRef === taskRef));
            if (runs.length < TASK_RUN_PAGE_SIZE) break;
          }
          return {
            runs: matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(withStatus),
            total: matches.length,
          };
        }
        const result = object(await call(`workflows/${workflowId}/runs?resourceId=${projectRef}&page=${currentPage}&perPage=${pageSize}`), 'Mastra runs');
        return { ...result, runs: Array.isArray(result.runs) ? result.runs.map(withStatus) : [] };
      }
      if (input.operation === 'run') {
        const run = await ownedRun(workflowId, string(input.runId, RUN_ID, 'runId'), projectRef);
        return { ...run, result: runOutput(run.result) };
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
        // The run is created first and started without waiting for it: a workflow can
        // run far longer than any caller waits for a response.
        const created = await call(`workflows/${workflowId}/create-run?runId=${encodeURIComponent(eventId)}`, {
          method: 'POST',
          body: JSON.stringify({ resourceId: projectRef }),
        });
        await call(`workflows/${workflowId}/start?runId=${encodeURIComponent(eventId)}`, {
          method: 'POST',
          body: JSON.stringify({ inputData: envelope, requestContext: envelope.context }),
        });
        return { runId: created?.runId ?? eventId, resourceId: projectRef, status: 'running' };
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
              metadata: { projectRef, source: 'itsaplan', scheduleKey },
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
        const schedule = await ownedSchedule(workflowId, scheduleId, projectRef);
        if (input.operation === 'schedule') {
          return withLastRun(workflowId, schedule);
        }
        if (input.operation === 'schedule-triggers') {
          return call(`schedules/${scheduleId}/triggers?limit=${page(input.limit, 20, 100)}`);
        }
        if (input.operation === 'update-schedule') {
          return call(`schedules/${scheduleId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              cron: cron(input.cron),
              ...(input.timezone === undefined ? {} : { timezone: timezone(input.timezone) }),
              ...(input.payload === undefined ? {} : { inputData: object(input.payload, 'payload') }),
            }),
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
        // The step the run is suspended in; like a start, the resumed run is not waited for.
        const step = Object.entries(run.steps ?? {}).find(([, result]) => result?.status === 'suspended')?.[0] ?? 'approval-gate';
        return call(`workflows/${workflowId}/resume?runId=${encodeURIComponent(runId)}`, {
          method: 'POST',
          body: JSON.stringify({
            step,
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
        // Mastra's restart answers a failed run with its stored failure. Time travel runs
        // the failed step again with the stored results of the steps before it, and with
        // the input the step failed with: a step of a loop ran with the output of its
        // previous iteration. Like a start, it is not waited for.
        const [step, failed] = Object.entries(run.steps ?? {}).find(([, result]) => result?.status === 'failed') ?? [];
        if (!step) throw new MastraControlError(409, 'Workflow run has no failed step');
        await call(`workflows/${workflowId}/time-travel?runId=${encodeURIComponent(runId)}`, {
          method: 'POST',
          body: JSON.stringify({
            step,
            ...(failed?.payload === undefined ? {} : { inputData: failed.payload }),
            requestContext: { projectRef },
          }),
        });
        return { runId, resourceId: projectRef, status: 'running' };
      }
      throw new MastraControlError(400, 'Control operation is invalid');
    },
  };
}
