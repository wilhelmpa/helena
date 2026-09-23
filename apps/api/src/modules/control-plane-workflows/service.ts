import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db, projectWorkflowAssignment, type ProjectWorkflowConfiguration } from '@repo/db';
import { HttpError, iso } from '#shared/lib';
import { bumpControlPlaneRevision } from '#modules/sync/service';

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

export async function controlPlaneRequest<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(controlUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await controlToken()}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ schemaVersion: 1, ...body }),
    redirect: 'error',
    signal: AbortSignal.timeout(330_000),
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

async function catalogFlows(): Promise<CatalogFlow[]> {
  const result = await controlPlaneRequest<{ catalog?: { flows?: CatalogFlow[] } }>({
    operation: 'catalog',
  });
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
// policy the start request carries.
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
  return flows.map((flow) => {
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
  return row;
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
) {
  return controlPlaneRequest({
    operation: 'runs',
    workflowId,
    projectRef: projectWorkflowScope(project).projectRef,
    page,
    pageSize,
  });
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
  const result = await controlPlaneRequest({
    operation: 'start',
    workflowId,
    ...context,
    eventId: input.idempotencyKey,
    correlationId: input.correlationId,
    occurredAt: new Date().toISOString(),
    actorId: userId,
    dryRun: input.dryRun,
    payload: {
      ...input.payload,
      ...(workflowId === 'agent-team'
        ? { policy: agentTeamPolicy(row.configuration, input.payload.policy) }
        : {}),
      configuration: row.configuration,
    },
    capabilityRefs: row.capabilityRefs,
    connectionRefs: [],
  });
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

export async function createWorkflowSchedule(
  project: ProjectContext,
  workflowId: string,
  input: { cron: string; timezone: string; payload: Record<string, unknown> },
) {
  const row = await enabledAssignment(project.id, workflowId);
  const context = {
    ...projectWorkflowScope(project),
    capabilityRefs: row.capabilityRefs,
    connectionRefs: [],
  };
  const eventId = randomUUID();
  const result = await controlPlaneRequest({
    operation: 'create-schedule',
    workflowId,
    ...context,
    cron: input.cron,
    timezone: input.timezone,
    payload: {
      eventId,
      correlationId: eventId,
      occurredAt: new Date().toISOString(),
      source: 'itsaplan-schedule',
      actor: { type: 'service', id: 'itsaplan-schedule' },
      context,
      dryRun: true,
      payload: {
        ...input.payload,
        projectKey: project.key,
        workflowRef: `workflow:${workflowId}:v1`,
      },
    },
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
  await enabledAssignment(project.id, workflowId);
  const result = await controlPlaneRequest({
    operation: action,
    workflowId,
    scheduleId,
    projectRef: projectWorkflowScope(project).projectRef,
  });
  await bumpControlPlaneRevision(project.id);
  return result;
}

export async function updateWorkflowSchedule(
  project: ProjectContext,
  workflowId: string,
  scheduleId: string,
  input: { cron: string; timezone: string },
) {
  await enabledAssignment(project.id, workflowId);
  const result = await controlPlaneRequest({
    operation: 'update-schedule',
    workflowId,
    scheduleId,
    projectRef: projectWorkflowScope(project).projectRef,
    ...input,
  });
  await bumpControlPlaneRevision(project.id);
  return result;
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
