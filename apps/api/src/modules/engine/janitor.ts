import { DBOS, type WorkflowStatusString } from '@dbos-inc/dbos-sdk';
import { db, pipelineRun, recordServiceCheck, serviceHeartbeat } from '@repo/db';
import { and, eq, like, lt, ne, sql } from 'drizzle-orm';
import { engineExecutorId, engineRunning } from './dbos';
import { signalFinishedAgentRuns, startLostRuns } from './runs';
import { fireDueSchedules } from './schedules';
import { fireDueSystemJobs } from './system-jobs';

// The engine's own background passes, run by the api's background jobs. The quick pass
// fires the schedules whose time has come, wakes runs whose agent runs finished, starts
// runs whose start was lost and reports the engine alive. The maintenance pass hands the
// pending runs of an executor that is gone to the others, prunes skipped routine fires
// and the engine's records of old workflows.

// An executor unseen this long is gone: its pending runs are resumed by the others.
const EXECUTOR_GONE_MS = 5 * 60_000;

// Missed and task-open fires of routines are kept this long; every other run stays.
const SKIPPED_RETENTION_DAYS = 90;

// How long the engine keeps its own record of a finished workflow (Helena's run history
// in pipeline_run stays): an event's for a week, a run's for a month, a failed run's for
// 90 days, as long as "Erneut versuchen" is offered.
const ENGINE_RETENTION: { names: string[]; statuses: WorkflowStatusString[]; days: number }[] = [
  { names: ['helena.event'], statuses: ['SUCCESS', 'CANCELLED', 'ERROR'], days: 7 },
  { names: ['helena.fire'], statuses: ['SUCCESS', 'CANCELLED', 'ERROR'], days: 30 },
  { names: ['helena.job'], statuses: ['SUCCESS', 'CANCELLED', 'ERROR'], days: 30 },
  { names: ['helena.run'], statuses: ['SUCCESS', 'CANCELLED'], days: 30 },
  { names: ['helena.run'], statuses: ['ERROR'], days: 90 },
];

export async function engineTick(): Promise<void> {
  if (!engineRunning()) return;
  await recordServiceCheck('engine', null);
  await recordServiceCheck(`engine:${engineExecutorId()}`, null);
  await fireDueSchedules();
  await fireDueSystemJobs();
  await signalFinishedAgentRuns();
  await startLostRuns();
}

// Resumes the pending runs of executors whose heartbeat stopped, on any executor.
async function recoverGoneExecutors(): Promise<number> {
  const me = `engine:${engineExecutorId()}`;
  const gone = await db
    .select({ service: serviceHeartbeat.service })
    .from(serviceHeartbeat)
    .where(
      and(
        like(serviceHeartbeat.service, 'engine:%'),
        ne(serviceHeartbeat.service, me),
        lt(serviceHeartbeat.lastSeenAt, new Date(Date.now() - EXECUTOR_GONE_MS)),
      ),
    );
  let resumed = 0;
  for (const row of gone) {
    const executorId = row.service.slice('engine:'.length);
    const pending = await DBOS.listWorkflows({ status: 'PENDING', executorId, limit: 1_000 });
    if (pending.length > 0) {
      await DBOS.resumeWorkflows(pending.map((item) => item.workflowID));
      resumed += pending.length;
    }
    await db.delete(serviceHeartbeat).where(eq(serviceHeartbeat.service, row.service));
  }
  return resumed;
}

async function pruneSkippedRuns(): Promise<number> {
  const rows = await db
    .delete(pipelineRun)
    .where(
      and(
        eq(pipelineRun.status, 'skipped'),
        lt(pipelineRun.createdAt, sql`now() - make_interval(days => ${SKIPPED_RETENTION_DAYS})`),
      ),
    )
    .returning({ id: pipelineRun.id });
  return rows.length;
}

async function pruneEngineHistory(): Promise<number> {
  let deleted = 0;
  for (const { names, statuses, days } of ENGINE_RETENTION) {
    const completedBefore = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await DBOS.listWorkflows({
      workflowName: names,
      status: statuses,
      completedBefore,
      limit: 500,
      loadInput: false,
      loadOutput: false,
    });
    if (rows.length === 0) continue;
    await DBOS.deleteWorkflows(
      rows.map((row) => row.workflowID),
      true,
    );
    deleted += rows.length;
  }
  return deleted;
}

// Answers how much it changed, for the health overview.
export async function engineMaintenance(): Promise<number> {
  if (!engineRunning()) return 0;
  return (await recoverGoneExecutors()) + (await pruneSkippedRuns()) + (await pruneEngineHistory());
}
