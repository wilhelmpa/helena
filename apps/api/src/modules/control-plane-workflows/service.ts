import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq } from 'drizzle-orm';
import {
  db,
  project as projectTable,
  projectWorkflowAssignment,
  type ProjectWorkflowConfiguration,
} from '@repo/db';
import { HttpError, iso } from '#shared/lib';
import { bumpControlPlaneRevision } from '#modules/sync/service';

// The workflow a routine of the Schedules page runs.
export const ROUTINE_WORKFLOW = 'agent-routine';

// The time zone of a schedule that names none.
export const DEFAULT_TIMEZONE = 'Europe/Berlin';

interface ProjectContext {
  id: number;
  key: string;
  teamId: number;
}

interface CatalogFlow {
  id: string;
  capabilityRefs?: string[];
  externalEffects?: boolean;
  [key: string]: unknown;
}

let tokenPromise: Promise<string> | null = null;

// The environment is read on use rather than at import, so a test can point the
// client at a control endpoint of its own.
function controlUrl(): URL {
  const url = new URL(
    process.env.MASTRA_CONTROL_URL?.trim() || 'http://127.0.0.1:4111/internal/mastra/control',
  );
  const privateHost =
    url.hostname === '127.0.0.1' ||
    /^10\./.test(url.hostname) ||
    /^192\.168\./.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
  if (
    url.protocol !== 'http:' ||
    !privateHost ||
    url.username ||
    url.password ||
    url.pathname !== '/internal/mastra/control' ||
    url.search ||
    url.hash
  ) {
    throw new HttpError(503, 'Workflow control plane is not configured');
  }
  return url;
}

// The health endpoint of the control plane's proxy, which answers only while Mastra
// behind it does.
export function controlPlaneHealthUrl(): URL {
  return new URL('/healthz', controlUrl());
}

async function controlToken(): Promise<string> {
  const tokenFile =
    process.env.MASTRA_CONTROL_TOKEN_FILE?.trim() || '/run/secrets/mastra_control_token';
  tokenPromise ??= fs
    .lstat(tokenFile)
    .then(async (stat) => {
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
        throw new Error('invalid secret file');
      const token = (await fs.readFile(tokenFile, 'utf8')).trim();
      if (Buffer.byteLength(token) < 32 || token.length > 2048) throw new Error('invalid token');
      return token;
    })
    .catch(() => {
      tokenPromise = null;
      throw new HttpError(503, 'Workflow control plane is not configured');
    });
  return tokenPromise;
}

export async function controlPlaneRequest<T = unknown>(
  body: Record<string, unknown>,
  timeoutMs = 330_000,
): Promise<T> {
  const response = await fetch(controlUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await controlToken()}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ schemaVersion: 1, ...body }),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => {
    throw new HttpError(502, 'Workflow control plane is unavailable');
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const status =
      response.status === 404
        ? 404
        : response.status === 409
          ? 409
          : response.status < 500
            ? 400
            : 502;
    const message =
      value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
        ? value.message
        : 'Workflow control request failed';
    throw new HttpError(status, message);
  }
  return value as T;
}

function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export async function catalogFlows(timeoutMs?: number): Promise<CatalogFlow[]> {
  const result = await controlPlaneRequest<{ catalog?: { flows?: CatalogFlow[] } }>(
    { operation: 'catalog' },
    timeoutMs,
  );
  return Array.isArray(result?.catalog?.flows) ? result.catalog.flows : [];
}

// The agent-team settings with their defaults: the coordinator reviews the work, the
// task stays in Review for a person, and Hermes keeps its own turn and time limits.
function agentTeamConfiguration(configuration: ProjectWorkflowConfiguration) {
  return {
    ...configuration,
    autonomy: configuration.autonomy ?? 'review',
    reviewRequired: configuration.reviewRequired ?? true,
    maxTurns: configuration.maxTurns ?? null,
    runBudgetSeconds: configuration.runBudgetSeconds ?? null,
  };
}

function effectiveConfiguration(workflowId: string, configuration: ProjectWorkflowConfiguration) {
  return workflowId === 'agent-team' ? agentTeamConfiguration(configuration) : configuration;
}

// The policy of an agent-team run: the project's settings replace the same fields of a
// policy the start request carries, and a limit the project leaves unset keeps the
// request's.
function agentTeamPolicy(configuration: ProjectWorkflowConfiguration, requested: unknown) {
  const settings = agentTeamConfiguration(configuration);
  return {
    ...(requested && typeof requested === 'object' && !Array.isArray(requested) ? requested : {}),
    reviewRequired: settings.reviewRequired,
    autonomy: settings.autonomy,
    ...(settings.maxTurns ? { maxTurns: settings.maxTurns } : {}),
    ...(settings.runBudgetSeconds ? { runBudgetSeconds: settings.runBudgetSeconds } : {}),
  };
}

async function assignment(projectId: number, workflowId: string) {
  const [row] = await db
    .select()
    .from(projectWorkflowAssignment)
    .where(
      and(
        eq(projectWorkflowAssignment.projectId, projectId),
        eq(projectWorkflowAssignment.workflowId, workflowId),
      ),
    );
  return row ?? null;
}

export async function listProjectWorkflows(projectId: number) {
  const [flows, assignments] = await Promise.all([
    catalogFlows(),
    db
      .select()
      .from(projectWorkflowAssignment)
      .where(eq(projectWorkflowAssignment.projectId, projectId))
      .orderBy(asc(projectWorkflowAssignment.workflowId)),
  ]);
  const assigned = new Map(assignments.map((row) => [row.workflowId, row]));
  // Routines are managed on the Schedules page and need no assignment.
  return flows
    .filter((flow) => flow.id !== ROUTINE_WORKFLOW)
    .map((flow) => {
      const row = assigned.get(flow.id);
      return {
        ...flow,
        assignment: row
          ? {
              enabled: row.enabled,
              capabilityRefs: row.capabilityRefs,
              configuration: effectiveConfiguration(flow.id, row.configuration),
              createdAt: iso(row.createdAt),
              updatedAt: iso(row.updatedAt),
            }
          : {
              enabled: false,
              capabilityRefs: [],
              configuration: effectiveConfiguration(flow.id, {}),
            },
      };
    });
}

export async function setProjectWorkflowAssignment(input: {
  projectId: number;
  workflowId: string;
  enabled: boolean;
  capabilityRefs: string[];
  configuration?: ProjectWorkflowConfiguration;
  createdBy: string;
}) {
  if (input.workflowId === 'agent-team') {
    const settings = agentTeamConfiguration(input.configuration ?? {});
    if (settings.autonomy === 'done' && !settings.reviewRequired)
      throw new HttpError(400, 'Autonomy done requires the coordinator review');
  }
  const flow = (await catalogFlows()).find((item) => item.id === input.workflowId);
  if (!flow) throw new HttpError(404, 'Workflow not found');
  const allowed = new Set(refs(flow.capabilityRefs));
  if (input.capabilityRefs.some((item) => !allowed.has(item)))
    throw new HttpError(400, 'The project does not grant a capability required by this workflow');
  const [row] = await db
    .insert(projectWorkflowAssignment)
    .values({
      projectId: input.projectId,
      workflowId: input.workflowId,
      enabled: input.enabled,
      capabilityRefs: [...new Set(input.capabilityRefs)],
      configuration: input.configuration ?? {},
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: [projectWorkflowAssignment.projectId, projectWorkflowAssignment.workflowId],
      set: {
        enabled: input.enabled,
        capabilityRefs: [...new Set(input.capabilityRefs)],
        configuration: input.configuration ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();
  await bumpControlPlaneRevision(input.projectId);
  // The settings are saved whether Mastra answers or not; the periodic pass brings the
  // schedules in line when this one could not.
  const [project] = await db
    .select({ key: projectTable.key })
    .from(projectTable)
    .where(eq(projectTable.id, input.projectId));
  if (project)
    await syncWorkflowSchedules(input.workflowId, [{ ...row!, projectKey: project.key }]).catch(
      (error: unknown) =>
        console.error(
          '[planner] workflow schedules not brought in line:',
          error instanceof Error ? error.message : error,
        ),
    );
  return row;
}

interface StoredSchedule {
  id: string;
  cron: string;
  status?: string;
  requestContext?: { projectRef?: unknown };
  inputData?: Record<string, unknown> & { payload?: Record<string, unknown> };
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// A settings save waits for the schedule sync, so a Mastra that does not answer holds
// it up this long per call at most.
const SYNC_TIMEOUT_MS = 10_000;

// The payload a fire carries under the project's settings. For agent-team, a run limit
// the stored settings had put into the policy goes when the settings no longer set it.
function payloadUnder(
  workflowId: string,
  configuration: ProjectWorkflowConfiguration,
  payload: Record<string, unknown>,
) {
  if (workflowId !== 'agent-team') return { ...payload, configuration };
  const stored = record(payload.configuration);
  const policy = { ...record(payload.policy) };
  for (const limit of ['maxTurns', 'runBudgetSeconds'])
    if (stored[limit] != null && policy[limit] === stored[limit]) delete policy[limit];
  return { ...payload, policy: agentTeamPolicy(configuration, policy), configuration };
}

// Mastra keeps the input a schedule was saved with. Brings the schedules of a workflow
// in line with the projects' settings in Plan: a workflow switched off in a project stops
// firing there, and its active schedules are paused, staying paused when it is switched
// on again; the fires of an enabled one carry the project's current configuration. Run
// when the settings change and periodically, which repairs a change Mastra missed while
// it was down.
async function syncWorkflowSchedules(
  workflowId: string,
  assignments: {
    projectKey: string;
    enabled: boolean;
    configuration: ProjectWorkflowConfiguration;
  }[],
): Promise<number> {
  const byProject = new Map(assignments.map((item) => [`project:${item.projectKey}`, item]));
  const result = await controlPlaneRequest<{ schedules?: StoredSchedule[] }>(
    { operation: 'schedules', workflowId, projectRefs: [...byProject.keys()], lastRun: false },
    SYNC_TIMEOUT_MS,
  );
  let changed = 0;
  for (const schedule of result.schedules ?? []) {
    const projectRef = String(schedule.requestContext?.projectRef);
    const assignment = byProject.get(projectRef);
    if (!assignment) continue;
    const scope = { workflowId, scheduleId: schedule.id, projectRef };
    const payload = record(schedule.inputData?.payload);
    const current = payloadUnder(workflowId, assignment.configuration, payload);
    const change = !assignment.enabled
      ? schedule.status === 'active'
        ? { operation: 'pause-schedule', ...scope }
        : null
      : schedule.inputData && !isDeepStrictEqual(current, payload)
        ? {
            operation: 'update-schedule',
            ...scope,
            cron: schedule.cron,
            payload: { ...schedule.inputData, payload: current },
          }
        : null;
    if (!change) continue;
    // One schedule Mastra refuses does not hold up the others.
    try {
      await controlPlaneRequest(change, SYNC_TIMEOUT_MS);
      changed += 1;
    } catch (error) {
      console.error(
        `[planner] schedule ${schedule.id} not brought in line:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return changed;
}

// The periodic pass of syncWorkflowSchedules over every workflow a project has settings
// for. Returns how many schedules it paused or updated.
export async function reconcileWorkflowSchedules(): Promise<number> {
  const rows = await db
    .select({
      workflowId: projectWorkflowAssignment.workflowId,
      enabled: projectWorkflowAssignment.enabled,
      configuration: projectWorkflowAssignment.configuration,
      projectKey: projectTable.key,
    })
    .from(projectWorkflowAssignment)
    .innerJoin(projectTable, eq(projectTable.id, projectWorkflowAssignment.projectId));
  let changed = 0;
  for (const workflowId of new Set(rows.map((row) => row.workflowId)))
    changed += await syncWorkflowSchedules(
      workflowId,
      rows.filter((row) => row.workflowId === workflowId),
    ).catch((error: unknown) => {
      console.error(
        `[planner] schedules of ${workflowId} not brought in line:`,
        error instanceof Error ? error.message : error,
      );
      return 0;
    });
  return changed;
}

export function projectWorkflowScope(project: ProjectContext) {
  return {
    projectRef: `project:${project.key}`,
    organizationRef: `organization:${project.teamId}`,
  };
}

async function enabledAssignment(projectId: number, workflowId: string) {
  const row = await assignment(projectId, workflowId);
  if (!row?.enabled) throw new HttpError(409, 'Workflow is not enabled for this project');
  return row;
}

export function listWorkflowRuns(
  project: ProjectContext,
  workflowId: string,
  page = 0,
  pageSize = 20,
  timeoutMs?: number,
) {
  return controlPlaneRequest<{ runs?: unknown[] }>(
    {
      operation: 'runs',
      workflowId,
      projectRef: projectWorkflowScope(project).projectRef,
      page,
      pageSize,
    },
    timeoutMs,
  );
}

// Every run of the workflow whose payload names the task, newest first.
export function listTaskWorkflowRuns(project: ProjectContext, workflowId: string, taskRef: string) {
  return controlPlaneRequest<{ runs?: unknown[] }>({
    operation: 'runs',
    workflowId,
    projectRef: projectWorkflowScope(project).projectRef,
    taskRef,
    page: 0,
    pageSize: 100,
  });
}

export async function isWorkflowEnabled(projectId: number, workflowId: string) {
  return (await assignment(projectId, workflowId))?.enabled === true;
}

export function getWorkflowRun(project: ProjectContext, workflowId: string, runId: string) {
  return controlPlaneRequest({
    operation: 'run',
    workflowId,
    runId,
    projectRef: projectWorkflowScope(project).projectRef,
  });
}

export async function startWorkflow(
  project: ProjectContext,
  workflowId: string,
  userId: string,
  input: {
    idempotencyKey: string;
    correlationId?: string;
    dryRun: boolean;
    payload: Record<string, unknown>;
  },
) {
  const row = await enabledAssignment(project.id, workflowId);
  const context = projectWorkflowScope(project);
  const result = await controlPlaneRequest(
    {
      operation: 'start',
      workflowId,
      ...context,
      eventId: input.idempotencyKey,
      correlationId: input.correlationId,
      occurredAt: new Date().toISOString(),
      actorId: userId,
      dryRun: input.dryRun,
      payload: payloadUnder(workflowId, row.configuration, input.payload),
      capabilityRefs: row.capabilityRefs,
      connectionRefs: [],
    },
    // The control plane starts the run without waiting for it, so a start that takes
    // longer is a control plane that does not answer; an issue delegation waits on it.
    30_000,
  );
  await bumpControlPlaneRevision(project.id);
  return result;
}

export async function decideWorkflowApproval(
  project: ProjectContext,
  workflowId: string,
  runId: string,
  userId: string,
  input: { approved: boolean; note?: string },
) {
  await enabledAssignment(project.id, workflowId);
  const result = await controlPlaneRequest({
    operation: 'resume',
    workflowId,
    runId,
    projectRef: projectWorkflowScope(project).projectRef,
    decidedBy: userId,
    ...input,
  });
  await bumpControlPlaneRevision(project.id);
  return result;
}

export async function cancelWorkflowRun(
  project: ProjectContext,
  workflowId: string,
  runId: string,
) {
  await enabledAssignment(project.id, workflowId);
  const result = await controlPlaneRequest({
    operation: 'cancel',
    workflowId,
    runId,
    projectRef: projectWorkflowScope(project).projectRef,
  });
  await bumpControlPlaneRevision(project.id);
  return result;
}

export async function retryWorkflowRun(project: ProjectContext, workflowId: string, runId: string) {
  await enabledAssignment(project.id, workflowId);
  const result = await controlPlaneRequest({
    operation: 'retry',
    workflowId,
    runId,
    projectRef: projectWorkflowScope(project).projectRef,
  });
  await bumpControlPlaneRevision(project.id);
  return result;
}

export function listWorkflowSchedules(project: ProjectContext, workflowId: string) {
  return controlPlaneRequest({
    operation: 'schedules',
    workflowId,
    projectRef: projectWorkflowScope(project).projectRef,
  });
}

// The input Mastra starts every fire of a schedule with. The fires are real runs; each
// takes its event id, correlation id and time from the run id Mastra gives it, so the
// ones stored here only identify the schedule's input. The member who saved the
// schedule is the actor of its runs.
function scheduleEnvelope(
  project: ProjectContext,
  actorUserId: string,
  capabilityRefs: string[],
  payload: Record<string, unknown>,
) {
  const eventId = randomUUID();
  return {
    eventId,
    correlationId: eventId,
    occurredAt: new Date().toISOString(),
    source: 'itsaplan-schedule',
    actor: { type: 'human', id: actorUserId },
    context: { ...projectWorkflowScope(project), capabilityRefs, connectionRefs: [] },
    dryRun: false,
    payload,
  };
}

// Creates a Mastra schedule of the project. `scheduleKey` makes the creation
// idempotent: a second create with the same key answers the schedule it made.
export async function createSchedule(
  project: ProjectContext,
  workflowId: string,
  actorUserId: string,
  input: {
    cron: string;
    timezone: string;
    scheduleKey?: string;
    capabilityRefs: string[];
    payload: Record<string, unknown>;
  },
) {
  const envelope = scheduleEnvelope(project, actorUserId, input.capabilityRefs, input.payload);
  const result = await controlPlaneRequest({
    operation: 'create-schedule',
    workflowId,
    ...envelope.context,
    ...(input.scheduleKey ? { scheduleKey: input.scheduleKey } : {}),
    cron: input.cron,
    timezone: input.timezone,
    payload: envelope,
  });
  await bumpControlPlaneRevision(project.id);
  return result;
}

export async function createWorkflowSchedule(
  project: ProjectContext,
  workflowId: string,
  actorUserId: string,
  input: { cron: string; timezone?: string; payload: Record<string, unknown> },
) {
  const row = await enabledAssignment(project.id, workflowId);
  // The fires run for real, so the payload carries the project's settings the way a
  // start does.
  return createSchedule(project, workflowId, actorUserId, {
    cron: input.cron,
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
    capabilityRefs: row.capabilityRefs,
    payload: {
      ...payloadUnder(workflowId, row.configuration, input.payload),
      projectKey: project.key,
      workflowRef: `workflow:${workflowId}:v1`,
    },
  });
}

export async function controlSchedule(
  project: ProjectContext,
  workflowId: string,
  scheduleId: string,
  action: 'pause-schedule' | 'resume-schedule' | 'run-schedule' | 'delete-schedule',
) {
  const result = await controlPlaneRequest({
    operation: action,
    workflowId,
    scheduleId,
    projectRef: projectWorkflowScope(project).projectRef,
  });
  await bumpControlPlaneRevision(project.id);
  return result;
}

export async function scheduleAction(
  project: ProjectContext,
  workflowId: string,
  scheduleId: string,
  action: 'pause-schedule' | 'resume-schedule' | 'run-schedule' | 'delete-schedule',
) {
  // A schedule of a workflow switched off can still be paused and deleted.
  if (action === 'resume-schedule' || action === 'run-schedule')
    await enabledAssignment(project.id, workflowId);
  return controlSchedule(project, workflowId, scheduleId, action);
}

// Changes the cadence of a schedule and, with `change`, the input of its fires, which
// then act for `actorUserId`. A schedule updated without a time zone keeps its own.
export async function updateSchedule(
  project: ProjectContext,
  workflowId: string,
  scheduleId: string,
  input: {
    cron: string;
    timezone?: string;
    change?: { actorUserId: string; capabilityRefs: string[]; payload: Record<string, unknown> };
  },
) {
  const result = await controlPlaneRequest({
    operation: 'update-schedule',
    workflowId,
    scheduleId,
    projectRef: projectWorkflowScope(project).projectRef,
    cron: input.cron,
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.change
      ? {
          payload: scheduleEnvelope(
            project,
            input.change.actorUserId,
            input.change.capabilityRefs,
            input.change.payload,
          ),
        }
      : {}),
  });
  await bumpControlPlaneRevision(project.id);
  return result;
}

export async function updateWorkflowSchedule(
  project: ProjectContext,
  workflowId: string,
  scheduleId: string,
  input: { cron: string; timezone?: string },
) {
  await enabledAssignment(project.id, workflowId);
  return updateSchedule(project, workflowId, scheduleId, input);
}

export async function listWorkflowScheduleTriggers(
  project: ProjectContext,
  workflowId: string,
  scheduleId: string,
) {
  return controlPlaneRequest({
    operation: 'schedule-triggers',
    workflowId,
    scheduleId,
    projectRef: projectWorkflowScope(project).projectRef,
    limit: 20,
  });
}
