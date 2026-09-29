import { DBOS } from '@dbos-inc/dbos-sdk';
import { db, pipelineRun, pipelineRunStep } from '@repo/db';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { engineRunning, enqueueWorkflow, insideOperation, RUNS_QUEUE } from './dbos';
import { ACTIVE_STATUSES } from './lifecycle';
import { stepType } from './registry';
import { runWorkflow } from './workflows';
import { localAiMayStartRoutine } from '#modules/local-ai/pressure';

// Starting, signalling, canceling and retrying engine runs. A run is written as a row
// first (pipeline_run, 'pending'); starting it hands it to the engine as the DBOS
// workflow of the same id, which is idempotent, so a start asked again (or by the
// janitor for a run whose start was lost) finds the workflow that runs it.

export async function startRun(runId: string): Promise<void> {
  if (!(await localAiMayStartRoutine(runId))) return;
  if (!engineRunning() || insideOperation()) {
    // A step of another run (it created the task this run works on) or a process without
    // the engine enqueues it; any executor's queue takes it.
    await enqueueWorkflow('helena.run', RUNS_QUEUE, runId, runId);
    return;
  }
  await DBOS.startWorkflow(runWorkflow, { workflowID: runId, queueName: RUNS_QUEUE })(runId);
}

// Starts the run, and leaves a start that fails to the janitor, which retries runs still
// pending after a while. The write that planned the run never waits on the engine.
export async function startRunSoon(runId: string): Promise<void> {
  try {
    await startRun(runId);
  } catch (error) {
    console.error(
      `[engine] run ${runId} not started yet:`,
      error instanceof Error ? error.message : error,
    );
  }
}

// Wakes the run's workflow if it waits for a signal on the topic (an agent run that
// finished, an approval decided). A signal is only a wake-up call: the workflow reads
// what changed, and without the signal it looks again after its wait times out.
export async function signalRun(
  runId: string,
  topic: string,
  message: Record<string, unknown> = {},
): Promise<void> {
  if (!engineRunning()) return;
  const [row] = await db
    .select({ workflowId: pipelineRun.workflowId, status: pipelineRun.status })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  if (!row?.workflowId || !(ACTIVE_STATUSES as readonly string[]).includes(row.status)) return;
  await DBOS.send(row.workflowId, { at: Date.now(), ...message }, topic).catch((error: unknown) => {
    console.error(
      `[engine] signal to run ${runId} failed:`,
      error instanceof Error ? error.message : error,
    );
  });
}

// The step executions of the run that are still in progress, with what their types
// started, for a cancel.
async function openExecutions(runId: string) {
  return db
    .select({
      stepId: pipelineRunStep.stepId,
      iteration: pipelineRunStep.iteration,
      seq: pipelineRunStep.seq,
      kind: pipelineRunStep.kind,
    })
    .from(pipelineRunStep)
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        inArray(pipelineRunStep.status, ['running', 'waiting']),
      ),
    );
}

// Stops a run: the engine stops its workflow, the step it is in stops what it started
// (an agent run is canceled), and the run is marked canceled. A finished run is refused.
export async function cancelEngineRun(runId: string): Promise<void> {
  const [row] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId));
  if (!row) throw new HttpError(404, 'Workflow run not found');
  if (!(ACTIVE_STATUSES as readonly string[]).includes(row.status))
    throw new HttpError(409, 'The workflow run has finished');
  await db
    .update(pipelineRun)
    .set({ status: 'canceled', finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pipelineRun.id, runId), inArray(pipelineRun.status, [...ACTIVE_STATUSES])));
  if (engineRunning() && row.workflowId)
    await DBOS.cancelWorkflow(row.workflowId).catch((error: unknown) => {
      console.error(
        `[engine] cancel of run ${runId} failed:`,
        error instanceof Error ? error.message : error,
      );
    });
  for (const execution of await openExecutions(runId)) {
    if (execution.stepId.includes('.')) continue;
    await stepType(execution.kind)?.cancel?.(runId, execution);
  }
  await db
    .update(pipelineRunStep)
    .set({ status: 'canceled', finishedAt: new Date() })
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        inArray(pipelineRunStep.status, ['running', 'waiting']),
      ),
    );
  await bumpControlPlaneRevision(row.projectId);
}

// "Erneut versuchen": runs a failed run again from the step it failed in, as a fork of
// its workflow; the steps before keep their results, and the failed step runs as its
// next attempt.
export async function retryEngineRun(runId: string): Promise<void> {
  const [row] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId));
  if (!row) throw new HttpError(404, 'Workflow run not found');
  if (row.status !== 'failed')
    throw new HttpError(409, 'Only a failed workflow run can be retried');
  if (!engineRunning()) throw new HttpError(503, 'The workflow engine is not running');
  const [failed] = await db
    .select({ stepId: pipelineRunStep.stepId, iteration: pipelineRunStep.iteration })
    .from(pipelineRunStep)
    .where(
      and(
        eq(pipelineRunStep.runId, runId),
        eq(pipelineRunStep.status, 'failed'),
        sql`${pipelineRunStep.stepId} NOT LIKE '%.%'`,
      ),
    )
    .orderBy(desc(pipelineRunStep.seq))
    .limit(1);
  const workflowId = row.workflowId ?? runId;
  // The engine keeps a failed run's record for 90 days (janitor.ts).
  if (!(await DBOS.getWorkflowStatus(workflowId)))
    throw new HttpError(409, 'This run is too old to retry; start the workflow again');
  const steps = (await DBOS.listWorkflowSteps(workflowId)) ?? [];
  const prefix = failed ? `helena:${failed.stepId}#${failed.iteration}:` : null;
  const start =
    (prefix ? steps.find((step) => step.name.startsWith(prefix)) : undefined) ??
    // A run that failed before its first step (or outside one) starts over from the top.
    steps.find((step) => step.name === 'helena:fail') ??
    steps[0];
  const forkId = `${runId}.r${Date.now().toString(36)}`;
  await db
    .update(pipelineRun)
    .set({
      status: 'running',
      error: null,
      finishedAt: null,
      workflowId: forkId,
      updatedAt: new Date(),
    })
    .where(and(eq(pipelineRun.id, runId), eq(pipelineRun.status, 'failed')));
  await DBOS.forkWorkflow(workflowId, start?.functionID ?? 0, { newWorkflowID: forkId });
  await bumpControlPlaneRevision(row.projectId);
}

// Wakes the runs whose agent runs finished: the janitor's quick pass, so a waiting step
// does not have to wait for its own timeout to notice.
export async function signalFinishedAgentRuns(): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT s.run_id AS "runId"
    FROM pipeline_run_step s
    JOIN agent_run a ON a.id = s.agent_run_id
    JOIN pipeline_run r ON r.id = s.run_id
    WHERE s.status = 'running'
      AND a.status <> 'pending'
      AND r.status IN ('running', 'waiting')
  `)) as unknown as { runId: string }[];
  for (const row of rows) await signalRun(row.runId, 'agent-run');
  return rows.length;
}

// Starts the runs a trigger planned whose start never reached the engine (the process
// stopped in between). The start is idempotent, so a run that did start is untouched.
export async function startLostRuns(olderThanSeconds = 30): Promise<number> {
  if (!engineRunning()) return 0;
  const rows = await db
    .select({ id: pipelineRun.id, kind: pipelineRun.kind })
    .from(pipelineRun)
    .where(
      and(
        eq(pipelineRun.status, 'pending'),
        lt(pipelineRun.createdAt, sql`now() - make_interval(secs => ${olderThanSeconds})`),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${pipelineRun.kind} = 'routine' THEN 1 ELSE 0 END`,
      pipelineRun.createdAt,
    )
    .limit(50);
  let started = 0;
  for (const row of rows) {
    if (row.kind === 'routine' && !(await localAiMayStartRoutine(row.id))) continue;
    await startRunSoon(row.id);
    started++;
  }
  return started;
}
