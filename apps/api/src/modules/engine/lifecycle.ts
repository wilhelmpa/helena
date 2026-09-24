import { db, pipelineRun, pipelineRunStep } from '@repo/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { listColumns } from '#modules/columns/service';
import { createIssue } from '#modules/issues/service';
import { getMembership } from '#modules/members/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import type { PipelineDefinition } from '#modules/pipelines/definition';
import { clip, loadRun, runInfo, setRunStatus, stepRow, writeStep } from './run-context';
import type { RunInfo, StepDefinition, StepExecution } from './sdk';

// The run's own records the interpreter writes around its steps: beginning a run
// (creating its task first when its trigger asks for one), entering a step execution,
// and ending the run. Each runs as a recorded operation of the run's workflow.

export const ACTIVE_STATUSES = ['pending', 'running', 'waiting'] as const;
export const FINISHED_STATUSES = [
  'succeeded',
  'failed',
  'canceled',
  'rejected',
  'skipped',
] as const;

export type Begun =
  { status: 'running'; run: RunInfo; definition: PipelineDefinition } | { status: 'finished' };

class RunHasTask extends Error {}

interface RunInput {
  task?: { title?: string; description?: string };
}

// A run whose trigger creates its task (a schedule fire, a webhook, a mail) gets it once,
// in the transaction that writes it onto the run.
async function createRunTask(runId: string): Promise<void> {
  const context = await loadRun(runId);
  const spec = (context.run.input as RunInput | null)?.task;
  if (context.run.issueId || !spec?.title) return;
  const unstarted = (await listColumns(context.project.id)).find(
    (column) => column.stateType === 'unstarted',
  );
  if (!unstarted) throw new Error('Project has no unstarted state');
  const actor =
    context.run.actorUserId && (await getMembership(context.project.id, context.run.actorUserId))
      ? context.run.actorUserId
      : null;
  try {
    await createIssue(
      context.project,
      {
        columnId: unstarted.id,
        title: spec.title.slice(0, 300),
        description: spec.description ?? '',
      },
      actor,
      {
        fromWorkflow: true,
        afterInsert: async (tx, issueId) => {
          const updated = await tx
            .update(pipelineRun)
            .set({ issueId, updatedAt: new Date() })
            .where(and(eq(pipelineRun.id, runId), isNull(pipelineRun.issueId)))
            .returning({ id: pipelineRun.id });
          if (updated.length === 0) throw new RunHasTask();
        },
      },
    );
  } catch (error) {
    if (!(error instanceof RunHasTask)) throw error;
  }
}

export async function beginRun(runId: string, workflowId: string): Promise<Begun> {
  const [row] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId));
  if (!row) throw new Error(`Workflow run ${runId} not found`);
  if (!(ACTIVE_STATUSES as readonly string[]).includes(row.status)) return { status: 'finished' };
  await createRunTask(runId);
  await db
    .update(pipelineRun)
    .set({
      workflowId,
      ...(row.status === 'pending' ? { status: 'running' } : {}),
      updatedAt: new Date(),
    })
    .where(eq(pipelineRun.id, runId));
  await bumpControlPlaneRevision(row.projectId);
  const context = await loadRun(runId);
  return { status: 'running', run: runInfo(context), definition: context.definition };
}

// Enters one step execution: writes its row the first time, or starts the next attempt
// of an execution that failed (a retry of the run). Answers the attempt.
export async function enterStep(
  runId: string,
  step: StepDefinition,
  at: StepExecution,
): Promise<number> {
  const existing = await stepRow(runId, at);
  if (!existing) {
    await writeStep(runId, step, at, { status: 'running', attempt: 1, startedAt: new Date() });
  } else if (existing.status === 'failed' || existing.status === 'canceled') {
    await writeStep(runId, step, at, {
      status: 'running',
      attempt: existing.attempt + 1,
      outcome: null,
      summary: null,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    });
    await setRunStatus(runId, 'running');
    return existing.attempt + 1;
  }
  await setRunStatus(runId, 'running');
  return existing?.attempt ?? 1;
}

// Closes a step execution that its type left running.
export async function leaveStep(runId: string, at: StepExecution, outcome?: string): Promise<void> {
  await db
    .update(pipelineRunStep)
    .set({
      status: 'succeeded',
      ...(outcome ? { outcome } : {}),
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.stepId, at.stepId),
        eq(pipelineRunStep.iteration, at.iteration),
        eq(pipelineRunStep.status, 'running'),
      ),
    );
}

// Ends the run. A canceled run stays canceled.
export async function finishRun(
  runId: string,
  status: 'succeeded' | 'rejected' | 'skipped' | 'failed',
  result: unknown,
  error: string | null = null,
): Promise<void> {
  const [row] = await db
    .update(pipelineRun)
    .set({
      status,
      ...(result !== undefined ? { result: result as object } : {}),
      error: error ? clip(error, 2_000) : null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(pipelineRun.id, runId), inArray(pipelineRun.status, [...ACTIVE_STATUSES])))
    .returning({ projectId: pipelineRun.projectId });
  if (row) await bumpControlPlaneRevision(row.projectId);
}

// Records why the run fails: on the step execution it failed in, when it has one, and on
// the run.
export async function failRun(
  runId: string,
  at: StepExecution | null,
  step: StepDefinition | null,
  message: string,
): Promise<void> {
  if (at && step) {
    const existing = await stepRow(runId, at);
    if (existing && existing.status !== 'failed')
      await writeStep(runId, step, at, {
        status: 'failed',
        outcome: existing.outcome ?? 'failed',
        error: clip(message, 2_000),
        finishedAt: new Date(),
      });
    else if (existing && !existing.error)
      await db
        .update(pipelineRunStep)
        .set({ error: clip(message, 2_000) })
        .where(
          and(
            eq(pipelineRunStep.runId, runId),
            eq(pipelineRunStep.stepId, at.stepId),
            eq(pipelineRunStep.iteration, at.iteration),
          ),
        );
  }
  await finishRun(runId, 'failed', undefined, message);
}

// Whether a person canceled the run.
export async function runCanceled(runId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: pipelineRun.status })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  return !row || row.status === 'canceled';
}
