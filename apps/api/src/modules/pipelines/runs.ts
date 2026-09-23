import { randomUUID } from 'node:crypto';
import {
  agentRun,
  aiAgent,
  db,
  issue,
  pipeline,
  pipelineRun,
  pipelineRunStep,
  pipelineVersion,
  project as projectTable,
  projectPipeline,
  projectSetting,
  user,
} from '@repo/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { runStatus } from '#modules/control-plane-workflows/agent-team';
import {
  controlPlaneRequest,
  PIPELINE_WORKFLOW,
  projectWorkflowScope,
} from '#modules/control-plane-workflows/service';
import { projectsWithPermission } from '#modules/approvals/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { usablePipeline, type ProjectRef } from './service';

// Runs of the workflow builder. Plan writes a run as 'pending' and asks Mastra to start
// plan-pipeline with the run id as its event id; Mastra reports every step back through
// the control API (control.ts). A start Mastra did not accept is retried by the api's
// background loop.

type RunRow = typeof pipelineRun.$inferSelect;

export type RunStatus =
  'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled' | 'rejected';

export const ACTIVE_STATUSES = ['pending', 'running', 'waiting'] as const;

const actor = alias(user, 'actor');
const decider = alias(user, 'decider');

async function issueProject(issueId: number): Promise<ProjectRef & { issueId: number }> {
  const [row] = await db
    .select({ id: projectTable.id, key: projectTable.key, teamId: projectTable.teamId })
    .from(issue)
    .innerJoin(projectTable, eq(projectTable.id, issue.projectId))
    .where(eq(issue.id, issueId));
  if (!row) throw new HttpError(404, 'Issue not found');
  return { ...row, issueId };
}

// Plans a run: the newest version of the workflow on the task. Null when the workflow
// already works on the task, which a trigger answers by starting nothing.
export async function createRun(input: {
  pipelineId: number;
  projectId: number;
  issueId: number;
  trigger: RunRow['trigger'];
  dryRun: boolean;
  actorUserId: string | null;
}): Promise<RunRow | null> {
  const [version] = await db
    .select({ id: pipelineVersion.id })
    .from(pipelineVersion)
    .innerJoin(pipeline, eq(pipeline.id, pipelineVersion.pipelineId))
    .where(
      and(
        eq(pipelineVersion.pipelineId, input.pipelineId),
        eq(pipelineVersion.version, pipeline.version),
      ),
    );
  if (!version) throw new HttpError(404, 'Workflow not found');
  const [row] = await db
    .insert(pipelineRun)
    .values({
      id: randomUUID(),
      pipelineId: input.pipelineId,
      versionId: version.id,
      projectId: input.projectId,
      issueId: input.issueId,
      trigger: input.trigger,
      dryRun: input.dryRun,
      actorUserId: input.actorUserId,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

// Asks Mastra to start the run. The run id is the event id, so a start that is asked
// again finds the run Mastra already made.
export async function startInMastra(run: RunRow): Promise<void> {
  const [project] = await db
    .select({ id: projectTable.id, key: projectTable.key, teamId: projectTable.teamId })
    .from(projectTable)
    .where(eq(projectTable.id, run.projectId));
  if (!project) return;
  await controlPlaneRequest(
    {
      operation: 'start',
      workflowId: PIPELINE_WORKFLOW,
      ...projectWorkflowScope(project),
      eventId: run.id,
      correlationId: run.id,
      occurredAt: iso(run.createdAt),
      actorId: run.actorUserId ?? 'itsaplan',
      dryRun: run.dryRun,
      payload: { schemaVersion: 1, pipelineId: run.pipelineId },
      capabilityRefs: [],
      connectionRefs: [],
    },
    30_000,
  );
  await db
    .update(pipelineRun)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(pipelineRun.id, run.id), eq(pipelineRun.status, 'pending')));
  await bumpControlPlaneRevision(run.projectId);
}

const START_ATTEMPTS = 10;

// Starts the runs a trigger planned. Several api replicas drain without overlapping; a
// start Mastra refuses is tried again later, and given up after START_ATTEMPTS.
export async function drainPendingStarts(): Promise<void> {
  const due = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(pipelineRun)
      .where(and(eq(pipelineRun.status, 'pending'), lte(pipelineRun.nextStartAt, new Date())))
      .orderBy(asc(pipelineRun.nextStartAt))
      .limit(10)
      .for('update', { skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(pipelineRun)
      .set({
        startAttempts: sql`${pipelineRun.startAttempts} + 1`,
        nextStartAt: sql`now() + make_interval(secs => least(600, 10 * power(2, ${pipelineRun.startAttempts})))`,
      })
      .where(
        inArray(
          pipelineRun.id,
          rows.map((row) => row.id),
        ),
      );
    return rows;
  });
  for (const run of due) {
    try {
      await startInMastra(run);
    } catch (error) {
      if (run.startAttempts + 1 < START_ATTEMPTS) continue;
      await finishRun(run.id, 'failed', error instanceof Error ? error.message : String(error));
    }
  }
}

export async function finishRun(
  runId: string,
  status: 'succeeded' | 'failed' | 'canceled' | 'rejected',
  error: string | null = null,
): Promise<void> {
  const [row] = await db
    .update(pipelineRun)
    .set({ status, error, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(pipelineRun.id, runId))
    .returning({ projectId: pipelineRun.projectId });
  if (row) await bumpControlPlaneRevision(row.projectId);
}

// Starts a workflow on the task by hand, or a test run of it. A test run needs no
// enabled workflow, which is what lets the editor try a draft's saved version.
export async function startRun(
  issueId: number,
  pipelineId: number,
  dryRun: boolean,
  userId: string,
) {
  const project = await issueProject(issueId);
  await usablePipeline(project, pipelineId);
  if (!dryRun) {
    const [usage] = await db
      .select({ enabled: projectPipeline.enabled })
      .from(projectPipeline)
      .where(
        and(eq(projectPipeline.projectId, project.id), eq(projectPipeline.pipelineId, pipelineId)),
      );
    if (!usage?.enabled) throw new HttpError(409, 'The workflow is not enabled in this project');
  }
  const run = await createRun({
    pipelineId,
    projectId: project.id,
    issueId,
    trigger: 'manual',
    dryRun,
    actorUserId: userId,
  });
  if (!run) throw new HttpError(409, 'The workflow already works on this task');
  try {
    await startInMastra(run);
  } catch (error) {
    await finishRun(run.id, 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
  return (await runDtos(eq(pipelineRun.id, run.id)))[0]!;
}

// The run history as Plan shows it: each run with the steps it executed, the agent run
// behind an agent step and the tokens they used.
async function runDtos(where: SQL | undefined, window?: { limit: number; offset: number }) {
  const query = db
    .select({
      run: pipelineRun,
      pipelineName: pipeline.name,
      version: pipelineVersion.version,
      projectKey: projectTable.key,
      sequenceNumber: issue.sequenceNumber,
      issueTitle: issue.title,
      actorName: actor.name,
    })
    .from(pipelineRun)
    .innerJoin(pipeline, eq(pipeline.id, pipelineRun.pipelineId))
    .innerJoin(pipelineVersion, eq(pipelineVersion.id, pipelineRun.versionId))
    .innerJoin(projectTable, eq(projectTable.id, pipelineRun.projectId))
    .leftJoin(issue, eq(issue.id, pipelineRun.issueId))
    .leftJoin(actor, eq(actor.id, pipelineRun.actorUserId))
    .where(where)
    .orderBy(desc(pipelineRun.createdAt), desc(pipelineRun.id))
    .$dynamic();
  const rows = window ? await query.limit(window.limit).offset(window.offset) : await query;
  if (rows.length === 0) return [];
  const steps = await stepDtos(rows.map(({ run }) => run));
  return rows.map(({ run, ...joined }) => {
    const own = steps.get(run.id) ?? [];
    const counted = own.filter(
      (step) => step.agentRun?.inputTokens != null || step.agentRun?.outputTokens != null,
    );
    return {
      id: run.id,
      pipelineId: run.pipelineId,
      pipelineName: joined.pipelineName,
      version: joined.version,
      projectId: run.projectId,
      projectKey: joined.projectKey,
      issueId: run.issueId,
      issueIdentifier:
        joined.sequenceNumber == null ? null : `${joined.projectKey}-${joined.sequenceNumber}`,
      issueTitle: joined.issueTitle,
      trigger: run.trigger,
      dryRun: run.dryRun,
      status: run.status as RunStatus,
      error: run.error,
      actorName: joined.actorName,
      inputTokens: counted.length
        ? counted.reduce((sum, step) => sum + (step.agentRun!.inputTokens ?? 0), 0)
        : null,
      outputTokens: counted.length
        ? counted.reduce((sum, step) => sum + (step.agentRun!.outputTokens ?? 0), 0)
        : null,
      createdAt: iso(run.createdAt),
      updatedAt: iso(run.updatedAt),
      finishedAt: run.finishedAt ? iso(run.finishedAt) : null,
      steps: own,
    };
  });
}

async function stepDtos(runs: RunRow[]) {
  const rows = await db
    .select({
      step: pipelineRunStep,
      agentUsername: aiAgent.username,
      agentName: user.name,
      decidedByName: decider.name,
    })
    .from(pipelineRunStep)
    .leftJoin(aiAgent, eq(aiAgent.id, pipelineRunStep.agentId))
    .leftJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(decider, eq(decider.id, pipelineRunStep.decidedBy))
    .where(
      inArray(
        pipelineRunStep.runId,
        runs.map((run) => run.id),
      ),
    )
    .orderBy(asc(pipelineRunStep.seq));
  const agentRuns = await agentRunsByKey(
    runs,
    rows.map(({ step }) => step.idempotencyKey),
  );
  const byRun = new Map<string, ReturnType<typeof stepDto>[]>();
  for (const row of rows) {
    const list = byRun.get(row.step.runId) ?? [];
    list.push(stepDto(row, agentRuns));
    byRun.set(row.step.runId, list);
  }
  return byRun;
}

function stepDto(
  row: {
    step: typeof pipelineRunStep.$inferSelect;
    agentUsername: string | null;
    agentName: string | null;
    decidedByName: string | null;
  },
  agentRuns: Map<string, AgentRunSummary>,
) {
  const { step } = row;
  return {
    stepId: step.stepId,
    iteration: step.iteration,
    seq: step.seq,
    kind: step.kind,
    name: step.name,
    status: step.status,
    outcome: step.outcome,
    summary: step.summary,
    attempt: step.attempt,
    agent:
      step.agentId && row.agentUsername
        ? {
            id: step.agentId,
            username: row.agentUsername,
            name: row.agentName ?? row.agentUsername,
          }
        : null,
    agentRun: (step.idempotencyKey && agentRuns.get(step.idempotencyKey)) || null,
    decidedByName: row.decidedByName,
    note: step.note,
    wakeAt: step.wakeAt ? iso(step.wakeAt) : null,
    error: step.error,
    startedAt: iso(step.startedAt),
    finishedAt: step.finishedAt ? iso(step.finishedAt) : null,
  };
}

interface AgentRunSummary {
  id: number;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

// The Plan agent run of each agent step, found through the idempotency key under which
// /internal/orchestration/agent-run stored it.
async function agentRunsByKey(runs: RunRow[], keys: (string | null)[]) {
  const wanted = keys.filter((key): key is string => key !== null);
  const found = new Map<string, AgentRunSummary>();
  if (wanted.length === 0) return found;
  const stored = await db
    .select({ key: projectSetting.key, value: projectSetting.value })
    .from(projectSetting)
    .where(
      and(
        inArray(projectSetting.projectId, [...new Set(runs.map((run) => run.projectId))]),
        inArray(
          projectSetting.key,
          wanted.map((key) => `mastra-agent-run:${key}`),
        ),
      ),
    );
  const idByKey = new Map(
    stored.map((row) => [
      row.key.slice('mastra-agent-run:'.length),
      Number((row.value as { runId?: unknown }).runId),
    ]),
  );
  const ids = [...idByKey.values()].filter((id) => Number.isSafeInteger(id));
  if (ids.length === 0) return found;
  const rows = await db
    .select({
      id: agentRun.id,
      status: agentRun.status,
      attempts: agentRun.attempts,
      nextAttemptAt: agentRun.nextAttemptAt,
      lastError: agentRun.lastError,
      inputTokens: agentRun.inputTokens,
      outputTokens: agentRun.outputTokens,
    })
    .from(agentRun)
    .where(inArray(agentRun.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [key, id] of idByKey) {
    const row = byId.get(id);
    if (row)
      found.set(key, {
        id: row.id,
        status: runStatus(row),
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      });
  }
  return found;
}

const RECENT_ISSUE_RUNS = 20;

export function listIssueRuns(issueId: number) {
  return runDtos(eq(pipelineRun.issueId, issueId), { limit: RECENT_ISSUE_RUNS, offset: 0 });
}

export async function getRun(runId: string) {
  const [run] = await runDtos(eq(pipelineRun.id, runId));
  if (!run) throw new HttpError(404, 'Workflow run not found');
  return run;
}

export async function runProjectId(runId: string): Promise<number | null> {
  const [row] = await db
    .select({ projectId: pipelineRun.projectId })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  return row?.projectId ?? null;
}

// The runs of one workflow in the given projects, newest first.
export async function listPipelineRuns(
  pipelineId: number,
  projectIds: number[],
  filter: { status?: RunStatus; dryRun?: boolean },
  window: { limit: number; offset: number },
) {
  if (projectIds.length === 0) return { items: [], total: 0 };
  const where = and(
    eq(pipelineRun.pipelineId, pipelineId),
    inArray(pipelineRun.projectId, projectIds),
    filter.status ? eq(pipelineRun.status, filter.status) : undefined,
    filter.dryRun === undefined ? undefined : eq(pipelineRun.dryRun, filter.dryRun),
  );
  const [items, [total]] = await Promise.all([
    runDtos(where, window),
    db.select({ value: count() }).from(pipelineRun).where(where),
  ]);
  return { items, total: total?.value ?? 0 };
}

// The projects whose runs of a workflow the user may read.
export async function readableProjectIds(
  userId: string,
  owner: { teamId: number; projectId: number | null },
  projectId?: number,
): Promise<number[]> {
  const readable = (await projectsWithPermission(userId, ['actions', 'read'])).filter(
    (project) => project.teamId === owner.teamId,
  );
  return readable
    .map((project) => project.id)
    .filter(
      (id) =>
        (owner.projectId === null || id === owner.projectId) &&
        (projectId === undefined || id === projectId),
    );
}

async function runForControl(runId: string) {
  const [row] = await db
    .select({ run: pipelineRun, key: projectTable.key, teamId: projectTable.teamId })
    .from(pipelineRun)
    .innerJoin(projectTable, eq(projectTable.id, pipelineRun.projectId))
    .where(eq(pipelineRun.id, runId));
  if (!row) throw new HttpError(404, 'Workflow run not found');
  return { run: row.run, project: { id: row.run.projectId, key: row.key, teamId: row.teamId } };
}

function mastraRun(project: ProjectRef, runId: string, operation: string, extra = {}) {
  return controlPlaneRequest({
    operation,
    workflowId: PIPELINE_WORKFLOW,
    runId,
    projectRef: projectWorkflowScope(project).projectRef,
    ...extra,
  });
}

// Stops a run. Mastra cancels the agent run the run waits for; a run Mastra never
// started, or no longer holds, is only marked canceled.
export async function cancelRun(runId: string) {
  const { run, project } = await runForControl(runId);
  if (!(ACTIVE_STATUSES as readonly string[]).includes(run.status))
    throw new HttpError(409, 'The workflow run has finished');
  if (run.status !== 'pending')
    await mastraRun(project, runId, 'cancel').catch((error) => {
      if (!(error instanceof HttpError && [404, 409].includes(error.status))) throw error;
    });
  await db
    .update(pipelineRunStep)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        inArray(pipelineRunStep.status, ['running', 'waiting']),
      ),
    );
  await finishRun(runId, 'canceled');
  return getRun(runId);
}

// Runs a failed run again from the step it failed in. Mastra keeps the results of the
// steps before it.
export async function retryRun(runId: string) {
  const { run, project } = await runForControl(runId);
  if (run.status !== 'failed')
    throw new HttpError(409, 'Only a failed workflow run can be retried');
  await mastraRun(project, runId, 'retry');
  await db
    .update(pipelineRun)
    .set({ status: 'running', error: null, finishedAt: null, updatedAt: new Date() })
    .where(eq(pipelineRun.id, runId));
  await bumpControlPlaneRevision(project.id);
  return getRun(runId);
}

// The approval step a run waits at, decided by a person. Mastra resumes the run with
// the decision and the note, which the later steps read.
export async function decideApproval(
  runId: string,
  userId: string,
  decision: { approved: boolean; note?: string },
) {
  const { run, project } = await runForControl(runId);
  const [waiting] = await db
    .select()
    .from(pipelineRunStep)
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.kind, 'approval'),
        eq(pipelineRunStep.status, 'waiting'),
      ),
    );
  if (run.status !== 'waiting' || !waiting)
    throw new HttpError(409, 'The workflow run does not wait for an approval');
  const note = decision.note?.trim() || undefined;
  await mastraRun(project, runId, 'resume', {
    approved: decision.approved,
    decidedBy: userId,
    ...(note ? { note } : {}),
  });
  await db
    .update(pipelineRunStep)
    .set({
      status: 'succeeded',
      outcome: decision.approved ? 'approved' : 'rejected',
      decidedBy: userId,
      note: note ?? null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.stepId, waiting.stepId),
        eq(pipelineRunStep.iteration, waiting.iteration),
      ),
    );
  await db
    .update(pipelineRun)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(pipelineRun.id, runId), eq(pipelineRun.status, 'waiting')));
  await bumpControlPlaneRevision(project.id);
  return getRun(runId);
}

// The approval steps waiting for a person, in the projects where the user may decide
// them.
export async function listWaitingApprovals(userId: string) {
  const projects = await projectsWithPermission(userId, ['actions', 'edit']);
  if (projects.length === 0) return [];
  const rows = await db
    .select({
      step: pipelineRunStep,
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      projectKey: projectTable.key,
      projectName: projectTable.name,
      issueId: issue.id,
      sequenceNumber: issue.sequenceNumber,
      issueTitle: issue.title,
    })
    .from(pipelineRunStep)
    .innerJoin(pipelineRun, eq(pipelineRun.id, pipelineRunStep.runId))
    .innerJoin(pipeline, eq(pipeline.id, pipelineRun.pipelineId))
    .innerJoin(projectTable, eq(projectTable.id, pipelineRun.projectId))
    .leftJoin(issue, eq(issue.id, pipelineRun.issueId))
    .where(
      and(
        eq(pipelineRunStep.kind, 'approval'),
        eq(pipelineRunStep.status, 'waiting'),
        eq(pipelineRun.status, 'waiting'),
        inArray(
          pipelineRun.projectId,
          projects.map((project) => project.id),
        ),
      ),
    )
    .orderBy(desc(pipelineRunStep.startedAt));
  return rows.map((row) => ({
    runId: row.step.runId,
    stepId: row.step.stepId,
    iteration: row.step.iteration,
    stepName: row.step.name,
    message: row.step.summary,
    pipelineId: row.pipelineId,
    pipelineName: row.pipelineName,
    projectKey: row.projectKey,
    projectName: row.projectName,
    issueId: row.issueId,
    issueIdentifier: row.sequenceNumber == null ? null : `${row.projectKey}-${row.sequenceNumber}`,
    issueTitle: row.issueTitle,
    waitingSince: iso(row.step.startedAt),
  }));
}

// The enabled workflows a member can start on the task.
export async function startablePipelines(issueId: number) {
  const project = await issueProject(issueId);
  return db
    .select({ id: pipeline.id, name: pipeline.name, description: pipeline.description })
    .from(projectPipeline)
    .innerJoin(pipeline, eq(pipeline.id, projectPipeline.pipelineId))
    .where(and(eq(projectPipeline.projectId, project.id), eq(projectPipeline.enabled, true)))
    .orderBy(asc(pipeline.name));
}
