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
  user,
} from '@repo/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { projectsWithPermission } from '#modules/approvals/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { recordApprovalDecision } from '#modules/engine/builtin/steps/approval';
import { cancelEngineRun, retryEngineRun, signalRun, startRunSoon } from '#modules/engine/runs';
import { usablePipeline, type ProjectRef } from './service';

// The runs of the Helena engine as Helena shows and controls them: the runs of a
// workflow of the builder, of the agent team of a task and of a routine, each with the
// steps it executed and the agent runs behind them. The engine (modules/engine) executes
// them; this module writes the run a person starts, and cancels, retries and decides.

type RunRow = typeof pipelineRun.$inferSelect;

export type RunStatus =
  'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled' | 'rejected' | 'skipped';

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

// Plans a run of a builder workflow: its newest version, on the task or on a task it
// creates first (`input.task`). Null when the workflow already works on the task, which
// a trigger answers by starting nothing, or when a run of the same id exists.
export async function createRun(input: {
  id?: string;
  pipelineId: number;
  projectId: number;
  issueId: number | null;
  trigger: string;
  dryRun: boolean;
  actorUserId: string | null;
  input?: Record<string, unknown>;
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
      id: input.id ?? randomUUID(),
      kind: 'workflow',
      pipelineId: input.pipelineId,
      versionId: version.id,
      projectId: input.projectId,
      issueId: input.issueId,
      trigger: input.trigger,
      dryRun: input.dryRun,
      actorUserId: input.actorUserId,
      input: input.input ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (row) await bumpControlPlaneRevision(input.projectId);
  return row ?? null;
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
  await startRunSoon(run.id);
  return (await runDtos(eq(pipelineRun.id, run.id)))[0]!;
}

// The run history as Helena shows it: each run with the steps it executed, the agent run
// behind an agent step and the tokens they used.
export async function runDtos(where: SQL | undefined, window?: { limit: number; offset: number }) {
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
    .leftJoin(pipeline, eq(pipeline.id, pipelineRun.pipelineId))
    .leftJoin(pipelineVersion, eq(pipelineVersion.id, pipelineRun.versionId))
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
      kind: run.kind as 'workflow' | 'agent_team' | 'routine',
      pipelineId: run.pipelineId,
      pipelineName:
        joined.pipelineName ?? run.title ?? (run.kind === 'agent_team' ? 'Agent team' : ''),
      version: joined.version,
      projectId: run.projectId,
      projectKey: joined.projectKey,
      issueId: run.issueId,
      issueIdentifier:
        joined.sequenceNumber == null ? null : `${joined.projectKey}-${joined.sequenceNumber}`,
      issueTitle: joined.issueTitle,
      scheduleId: run.scheduleId,
      scheduledFor: run.scheduledFor ? iso(run.scheduledFor) : null,
      trigger: run.trigger,
      dryRun: run.dryRun,
      status: run.status as RunStatus,
      error: run.error,
      // A failed run names the failure of the step that ended it, where one was explained.
      failure:
        run.status === 'failed'
          ? (own.find((step) => step.status === 'failed' && step.failure)?.failure ?? null)
          : null,
      result: run.result ?? null,
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

export type RunDto = Awaited<ReturnType<typeof runDtos>>[number];

// A run a runner holds stays 'pending' in the queue until the runner reports it. It is
// running while the lease of a claim is open; a run waiting for a retry carries the
// error of the attempt before.
export function agentRunStatus(run: {
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
}): string {
  return run.status === 'pending' &&
    run.attempts > 0 &&
    !run.lastError &&
    run.nextAttemptAt.getTime() > Date.now()
    ? 'running'
    : run.status;
}

async function stepDtos(runs: RunRow[]) {
  const rows = await db
    .select({
      step: pipelineRunStep,
      agentUsername: aiAgent.username,
      agentName: user.name,
      decidedByName: decider.name,
      agentRun: {
        id: agentRun.id,
        status: agentRun.status,
        attempts: agentRun.attempts,
        nextAttemptAt: agentRun.nextAttemptAt,
        lastError: agentRun.lastError,
        inputTokens: agentRun.inputTokens,
        outputTokens: agentRun.outputTokens,
        startedAt: agentRun.startedAt,
        finishedAt: agentRun.finishedAt,
        failure: agentRun.failure,
      },
    })
    .from(pipelineRunStep)
    .leftJoin(aiAgent, eq(aiAgent.id, pipelineRunStep.agentId))
    .leftJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(decider, eq(decider.id, pipelineRunStep.decidedBy))
    .leftJoin(agentRun, eq(agentRun.id, pipelineRunStep.agentRunId))
    .where(
      inArray(
        pipelineRunStep.runId,
        runs.map((run) => run.id),
      ),
    )
    // A step and the parts it writes in one transaction share their start: the step first.
    .orderBy(asc(pipelineRunStep.seq), asc(pipelineRunStep.startedAt), asc(pipelineRunStep.stepId));
  const byRun = new Map<string, ReturnType<typeof stepDto>[]>();
  for (const row of rows) {
    const list = byRun.get(row.step.runId) ?? [];
    list.push(stepDto(row));
    byRun.set(row.step.runId, list);
  }
  return byRun;
}

function stepDto(row: {
  step: typeof pipelineRunStep.$inferSelect;
  agentUsername: string | null;
  agentName: string | null;
  decidedByName: string | null;
  agentRun: {
    id: number;
    status: string;
    attempts: number;
    nextAttemptAt: Date;
    lastError: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    failure: unknown;
  } | null;
}) {
  const { step } = row;
  const dot = step.stepId.indexOf('.');
  return {
    stepId: step.stepId,
    // The step a part belongs to (an agent team's stage), or null for a step itself.
    parentStepId: dot > 0 ? step.stepId.slice(0, dot) : null,
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
    agentRun: row.agentRun?.id
      ? {
          id: row.agentRun.id,
          status: agentRunStatus(row.agentRun),
          inputTokens: row.agentRun.inputTokens,
          outputTokens: row.agentRun.outputTokens,
        }
      : null,
    decidedByName: row.decidedByName,
    note: step.note,
    wakeAt: step.wakeAt ? iso(step.wakeAt) : null,
    error: step.error,
    failure: stepFailure(row.agentRun?.failure, step.state),
    startedAt: iso(step.startedAt),
    finishedAt: step.finishedAt ? iso(step.finishedAt) : null,
  };
}

// Why a step failed, where the runtime's words said: its agent run's failure, or the one the
// engine recorded when it did not start the run (a model the provider already refused).
// Only the code and the model: the run view words it in the reader's language.
export function stepFailure(
  runFailure: unknown,
  state: unknown,
): { code: string; model: string | null } | null {
  const found =
    (runFailure as { code?: unknown; model?: unknown } | null) ??
    (state as { runtimeFailure?: { code?: unknown; model?: unknown } } | null)?.runtimeFailure ??
    null;
  if (!found || typeof found.code !== 'string') return null;
  return { code: found.code, model: typeof found.model === 'string' ? found.model : null };
}

// The explained failure of each failed run that has one (see stepFailure), by run id: for the
// views that show a run's error without its steps (a task's agent team, the health overview).
export async function runFailures(
  runIds: string[],
): Promise<Map<string, { code: string; model: string | null }>> {
  const found = new Map<string, { code: string; model: string | null }>();
  if (runIds.length === 0) return found;
  const rows = await db
    .select({
      runId: pipelineRunStep.runId,
      state: pipelineRunStep.state,
      failure: agentRun.failure,
    })
    .from(pipelineRunStep)
    .leftJoin(agentRun, eq(agentRun.id, pipelineRunStep.agentRunId))
    .where(and(inArray(pipelineRunStep.runId, runIds), eq(pipelineRunStep.status, 'failed')))
    .orderBy(asc(pipelineRunStep.seq), asc(pipelineRunStep.startedAt));
  for (const row of rows) {
    const failure = stepFailure(row.failure, row.state);
    if (failure && !found.has(row.runId)) found.set(row.runId, failure);
  }
  return found;
}

const RECENT_ISSUE_RUNS = 20;

export function listIssueRuns(issueId: number) {
  return runDtos(and(eq(pipelineRun.issueId, issueId), eq(pipelineRun.kind, 'workflow')), {
    limit: RECENT_ISSUE_RUNS,
    offset: 0,
  });
}

export async function getRun(runId: string) {
  const [run] = await runDtos(eq(pipelineRun.id, runId));
  if (!run) throw new HttpError(404, 'Workflow run not found');
  return run;
}

// The project and kind of a run, which decide who may read and control it.
export async function runAccess(
  runId: string,
): Promise<{ projectId: number; kind: string } | null> {
  const [row] = await db
    .select({ projectId: pipelineRun.projectId, kind: pipelineRun.kind })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  return row ?? null;
}

export async function runProjectId(runId: string): Promise<number | null> {
  return (await runAccess(runId))?.projectId ?? null;
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

// Stops a run: the engine stops its workflow and the agent run it waits for.
export async function cancelRun(runId: string) {
  await cancelEngineRun(runId);
  return getRun(runId);
}

// Runs a failed run again from the step it failed in; the steps before it keep their
// results.
export async function retryRun(runId: string) {
  await retryEngineRun(runId);
  return getRun(runId);
}

// The approval step a run waits at, decided by a person. The run reads the decision and
// the note, which the later steps read, when it wakes.
export async function decideApproval(
  runId: string,
  userId: string,
  decision: { approved: boolean; note?: string },
) {
  const [run] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId));
  if (!run) throw new HttpError(404, 'Workflow run not found');
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
  const decided = await recordApprovalDecision(runId, run.projectId, waiting, {
    approved: decision.approved,
    note: decision.note ?? null,
    decidedBy: userId,
  });
  if (!decided) throw new HttpError(409, 'The approval was decided in the meantime');
  await db
    .update(pipelineRun)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(pipelineRun.id, runId), eq(pipelineRun.status, 'waiting')));
  await bumpControlPlaneRevision(run.projectId);
  await signalRun(runId, 'decision');
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
      pipelineId: pipelineRun.pipelineId,
      pipelineName: sql<string>`coalesce(${pipeline.name}, ${pipelineRun.title}, '')`,
      projectKey: projectTable.key,
      projectName: projectTable.name,
      issueId: issue.id,
      sequenceNumber: issue.sequenceNumber,
      issueTitle: issue.title,
    })
    .from(pipelineRunStep)
    .innerJoin(pipelineRun, eq(pipelineRun.id, pipelineRunStep.runId))
    .leftJoin(pipeline, eq(pipeline.id, pipelineRun.pipelineId))
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
    pipelineId: row.pipelineId ?? 0,
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
