import { DBOS } from '@dbos-inc/dbos-sdk';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { agentRun, db, pipelineRun, pipelineRunStep } from '@repo/db';
import { and, asc, eq } from 'drizzle-orm';
import { engineClient, engineRunning, launchEngine, stopEngine } from '#modules/engine/dbos';
import { signalFinishedAgentRuns } from '#modules/engine/runs';
import { resetDb } from './db';

// DBOS 5.0.2 cancelWorkflows only records cancellation; shutdown without a timeout
// does not drain, and its optional timeout may silently abandon work. Tests need a
// strict join before TRUNCATE. Keep this pinned-SDK internal access test-only.
const require = createRequire(import.meta.url);
const { getExecutor } = require(
  join(dirname(require.resolve('@dbos-inc/dbos-sdk')), 'dbos.js'),
) as {
  getExecutor(): {
    deactivateEventReceivers(): Promise<void>;
    systemDatabase: { runningWorkflowMap: Map<string, { promise: Promise<unknown> }> };
  };
};

export const testEngineExecutions = () => getExecutor().systemDatabase.runningWorkflowMap;
let drainFailure: Error | null = null;

// The Helena engine in the api tests: it runs in the test process against the test
// database (its own schema `helena_engine`), and the test plays the Hermes runner by
// finishing the agent runs the engine queues.

// Waiting steps look again every second instead of every minute, and the queues are
// polled every 100 ms, so a run's hops take milliseconds.
process.env.HELENA_ENGINE_WAIT_SECONDS ??= '1';
process.env.HELENA_ENGINE_POLL_MS ??= '100';
process.env.HELENA_ENGINE_EXECUTOR_ID ??= 'api-tests';

// The engine runs only while a file that tests it runs (beforeAll → startEngine, afterAll
// → stopTestEngine). The other files publish their task events into the engine's queue
// without an engine taking them, so nothing works in the background while their
// resetDb truncates the tables; what they left is canceled before the engine starts.
export async function startEngine(): Promise<void> {
  if (drainFailure) throw drainFailure;
  await cancelLeftovers();
  await launchEngine();
}

// Cancels the workflows earlier files left queued or unfinished.
export async function cancelLeftovers(): Promise<void> {
  const client = await engineClient();
  const left = await client.listWorkflows({ status: ['PENDING', 'ENQUEUED'], limit: 10_000 });
  if (left.length > 0) await client.cancelWorkflows(left.map((item) => item.workflowID));
}

async function drainTestEngine(): Promise<void> {
  if (engineRunning()) {
    const executor = getExecutor();
    // Stop queue admission first, including a poll already dispatching workflows.
    await executor.deactivateEventReceivers();
    await stopEngineRuns();
    // A cancelled workflow can still be inside a step's application transaction.
    // Join its actual execution, including children it started while draining.
    while (executor.systemDatabase.runningWorkflowMap.size > 0) {
      const running = [...executor.systemDatabase.runningWorkflowMap.entries()];
      await DBOS.cancelWorkflows(running.map(([id]) => id));
      await Promise.all(running.map(([, entry]) => entry.promise));
    }
  }
  // After a deadline failure, final suite cleanup owns shutdown. A late-finishing
  // step must not race that cleanup into closing the SDK pools twice.
  if (!drainFailure) await stopEngine();
}

export async function stopTestEngine(timeoutMs = 10_000): Promise<void> {
  if (drainFailure) throw drainFailure;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      drainTestEngine(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () =>
            reject(new Error(`Test engine did not drain within ${timeoutMs} ms; reset blocked`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    // A stuck step must fail the hook, never authorize TRUNCATE or a fresh engine.
    // Keep the failure latched for later hooks; the test database's final drop
    // remains responsible for closing any abandoned application connections.
    drainFailure = error instanceof Error ? error : new Error(String(error));
    throw drainFailure;
  } finally {
    clearTimeout(deadline);
  }
}

export async function resetEngineDb(): Promise<void> {
  await stopTestEngine();
  await resetDb();
  await startEngine();
}

// Requests cancellation. A reset must use resetEngineDb, which also joins the local
// executions; a terminal database status alone does not mean their steps are done.
export async function stopEngineRuns(): Promise<void> {
  const pending = await DBOS.listWorkflows({ status: ['PENDING', 'ENQUEUED'], limit: 1_000 });
  if (pending.length > 0) await DBOS.cancelWorkflows(pending.map((item) => item.workflowID));
}

export async function runRow(runId: string) {
  const [row] = await db.select().from(pipelineRun).where(eq(pipelineRun.id, runId));
  return row ?? null;
}

export async function runSteps(runId: string) {
  return db
    .select()
    .from(pipelineRunStep)
    .where(eq(pipelineRunStep.runId, runId))
    .orderBy(asc(pipelineRunStep.seq), asc(pipelineRunStep.startedAt));
}

// Waits until the run satisfies the check, or fails the test after `timeoutMs`.
export async function waitForRun(
  runId: string,
  check: (run: NonNullable<Awaited<ReturnType<typeof runRow>>>) => boolean,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await runRow(runId);
    if (run && check(run)) return run;
    if (Date.now() > deadline)
      throw new Error(`Run ${runId} did not get there: ${JSON.stringify(run)}`);
    await Bun.sleep(100);
  }
}

export function waitForStatus(runId: string, ...statuses: string[]) {
  return waitForRun(runId, (run) => statuses.includes(run.status));
}

// Waits until the run has a pending agent run on the step (or part), and answers it.
export async function waitForAgentRun(runId: string, stepId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db
      .select({ agentRunId: pipelineRunStep.agentRunId, status: agentRun.status })
      .from(pipelineRunStep)
      .innerJoin(agentRun, eq(agentRun.id, pipelineRunStep.agentRunId))
      .where(
        and(
          eq(pipelineRunStep.runId, runId),
          eq(pipelineRunStep.stepId, stepId),
          eq(agentRun.status, 'pending'),
        ),
      )
      .limit(1);
    if (row?.agentRunId) {
      const [run] = await db.select().from(agentRun).where(eq(agentRun.id, row.agentRunId));
      return run!;
    }
    if (Date.now() > deadline)
      throw new Error(
        `No pending agent run on ${stepId} of run ${runId}: ${JSON.stringify(await runSteps(runId))}`,
      );
    await Bun.sleep(100);
  }
}

// Plays the runner: the agent run ends with the outcome, and the engine is told.
export async function finishAgentRun(
  agentRunId: number,
  outcome: {
    status?: 'success' | 'failed';
    output?: string;
    error?: string;
    blockedQuestion?: string;
    // Why the runner found it failed (@helena/sdk RuntimeFailure).
    failure?: { code: string; retryable: boolean; model?: string | null; detail?: string };
  },
): Promise<void> {
  const now = new Date();
  await db
    .update(agentRun)
    .set({
      status: outcome.status ?? 'success',
      output: outcome.output ?? null,
      lastError: outcome.error ?? null,
      blockedQuestion: outcome.blockedQuestion ?? null,
      failure: outcome.failure ?? null,
      claimedAt: now,
      startedAt: now,
      finishedAt: now,
      attempts: 1,
    })
    .where(eq(agentRun.id, agentRunId));
  await signalFinishedAgentRuns();
}

// Answers the pending agent run of a step with the output.
export async function answerStep(
  runId: string,
  stepId: string,
  outcome: Parameters<typeof finishAgentRun>[1],
) {
  const run = await waitForAgentRun(runId, stepId);
  await finishAgentRun(run.id, outcome);
  return run;
}
