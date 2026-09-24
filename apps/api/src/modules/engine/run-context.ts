import {
  db,
  pipeline,
  pipelineRun,
  pipelineRunStep,
  pipelineVersion,
  projectPipeline,
} from '@repo/db';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { listColumns } from '#modules/columns/service';
import { getIssue, type IssueRow } from '#modules/issues/service';
import { getProjectById } from '#modules/projects/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import {
  findStep,
  producesResult,
  type PipelineDefinition,
  type PipelineStep,
} from '#modules/pipelines/definition';
import {
  loadProjectContext,
  resolveRoles,
  type ContextAgent,
  type ProjectContext,
} from '#modules/pipelines/project-context';
import type { RenderContext, StepResult as RenderResult } from '#modules/pipelines/render';
import type { RunInfo, StepExecution } from './sdk';

// What the built-in step types read and write about the run they execute in: the run
// with its pinned definition, the task, the step rows, and the variables of a step's
// text. Every function here runs inside an `op` of the step, so it is recorded and not
// repeated when a run continues after a restart.

export const SUMMARY_LIMIT = 4_000;

// Task actions are written by this system actor. A change it makes starts no workflow,
// so two workflows cannot start each other in turn.
export const WORKFLOW_ACTOR = { system: 'Workflow' } as const;

type RunRow = typeof pipelineRun.$inferSelect;
export type StepRow = typeof pipelineRunStep.$inferSelect;

export function clip(text: string, limit = SUMMARY_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface RunContext {
  run: RunRow;
  project: NonNullable<Awaited<ReturnType<typeof getProjectById>>>;
  name: string;
  version: number | null;
  definition: PipelineDefinition;
  roles: Record<string, number>;
  task: IssueRow | null;
}

// The run as the step types see it. A run a person canceled executes nothing more; its
// results and its end are still recorded (`live` false).
export async function loadRun(runId: string, live = true): Promise<RunContext> {
  const [row] = await db
    .select({
      run: pipelineRun,
      pipelineName: pipeline.name,
      version: pipelineVersion.version,
      versionDefinition: pipelineVersion.definition,
      roles: projectPipeline.roles,
    })
    .from(pipelineRun)
    .leftJoin(pipeline, eq(pipeline.id, pipelineRun.pipelineId))
    .leftJoin(pipelineVersion, eq(pipelineVersion.id, pipelineRun.versionId))
    .leftJoin(
      projectPipeline,
      and(
        eq(projectPipeline.projectId, pipelineRun.projectId),
        eq(projectPipeline.pipelineId, pipelineRun.pipelineId),
      ),
    )
    .where(eq(pipelineRun.id, runId));
  if (!row) throw new HttpError(404, 'Workflow run not found');
  const project = await getProjectById(row.run.projectId);
  if (!project) throw new HttpError(404, 'Project not found');
  if (live && row.run.status === 'canceled')
    throw new HttpError(409, 'The workflow run was canceled');
  return {
    run: row.run,
    project,
    name: row.pipelineName ?? row.run.title ?? '',
    version: row.version,
    definition: (row.versionDefinition ?? row.run.definition) as PipelineDefinition,
    roles: row.roles ?? {},
    task: row.run.issueId ? await getIssue(row.run.issueId) : null,
  };
}

export function runInfo(context: RunContext): RunInfo {
  const { run, project } = context;
  return {
    id: run.id,
    kind: run.kind as RunInfo['kind'],
    project: { id: project.id, key: project.key, name: project.name, teamId: project.teamId },
    taskId: run.issueId,
    dryRun: run.dryRun,
    trigger: run.trigger,
    actorUserId: run.actorUserId,
    name: context.name,
    version: context.version,
    scheduleId: run.scheduleId,
    scheduledFor: run.scheduledFor ? run.scheduledFor.toISOString() : null,
    roles: context.roles,
  };
}

export async function stepRow(
  runId: string,
  at: StepExecution | { stepId: string; iteration: number },
) {
  const [row] = await db
    .select()
    .from(pipelineRunStep)
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.stepId, at.stepId),
        eq(pipelineRunStep.iteration, at.iteration),
      ),
    );
  return row ?? null;
}

type StepValues = Partial<
  Omit<typeof pipelineRunStep.$inferInsert, 'runId' | 'stepId' | 'iteration'>
>;

type Executor = Pick<typeof db, 'insert'>;

// Writes the row of one step execution, creating it the first time.
export async function writeStep(
  runId: string,
  step: { type: string; name: string },
  at: StepExecution,
  values: StepValues,
  executor: Executor = db,
): Promise<void> {
  const row = {
    kind: step.type,
    name: step.name,
    seq: at.seq,
    status: 'running',
    ...values,
  };
  await executor
    .insert(pipelineRunStep)
    .values({ runId, stepId: at.stepId, iteration: at.iteration, ...row })
    .onConflictDoUpdate({
      target: [pipelineRunStep.runId, pipelineRunStep.stepId, pipelineRunStep.iteration],
      set: row,
    });
}

// The run is running or waits (at an approval or a wait step). A finished run keeps its
// end.
export async function setRunStatus(runId: string, status: 'running' | 'waiting'): Promise<void> {
  const [row] = await db
    .update(pipelineRun)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(pipelineRun.id, runId),
        sql`${pipelineRun.status} IN ('pending', 'running', 'waiting')`,
        sql`${pipelineRun.status} <> ${status}`,
      ),
    )
    .returning({ projectId: pipelineRun.projectId });
  if (row) await bumpControlPlaneRevision(row.projectId);
}

function asResult(row: StepRow): RenderResult {
  const output = (row.state as { output?: unknown } | null)?.output;
  return {
    summary: row.summary ?? '',
    outcome: row.outcome ?? '',
    note: row.note ?? '',
    ...(output && typeof output === 'object' ? { output: output as Record<string, unknown> } : {}),
  };
}

// The variables of a step: the task as it is now, and the results the run recorded
// before this execution. `previous` is the newest result of a step that leaves one.
export async function renderContext(context: RunContext, seq: number): Promise<RenderContext> {
  const rows = await db
    .select()
    .from(pipelineRunStep)
    .where(and(eq(pipelineRunStep.runId, context.run.id), lt(pipelineRunStep.seq, seq)))
    .orderBy(desc(pipelineRunStep.seq));
  const steps: Record<string, RenderResult> = {};
  for (const row of [...rows].reverse()) steps[row.stepId] = asResult(row);
  const previous = rows.find((row) => {
    const step = findStep(context.definition.steps, row.stepId);
    return step !== undefined && producesResult(step);
  });
  const columns = context.task ? await listColumns(context.project.id) : [];
  return {
    task: {
      title: context.task?.title ?? '',
      description: context.task?.description ?? '',
      identifier: context.task?.identifier ?? '',
      status: columns.find((column) => column.id === context.task?.columnId)?.name ?? '',
    },
    previous: previous ? asResult(previous) : null,
    steps,
  };
}

export function projectContext(context: RunContext): Promise<ProjectContext> {
  return loadProjectContext({
    id: context.project.id,
    key: context.project.key,
    teamId: context.project.teamId,
  });
}

// The agent that fills a role in the project, or the agent a project workflow names.
export async function assigneeAgent(
  context: RunContext,
  assignee: { role: string } | { agentId: number },
): Promise<ContextAgent | null> {
  const projectAgents = await projectContext(context);
  if ('role' in assignee)
    return (
      resolveRoles(context.definition.roles, context.roles, projectAgents).find(
        (role) => role.key === assignee.role,
      )?.agent ?? null
    );
  return projectAgents.agents.find((candidate) => candidate.id === assignee.agentId) ?? null;
}

export function taskRefOf(context: RunContext): string | null {
  return context.task ? `task:${context.task.identifier}` : null;
}

export type { PipelineStep };
