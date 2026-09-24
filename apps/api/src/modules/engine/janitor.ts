import { DBOS } from '@dbos-inc/dbos-sdk';
import { db, pipelineRun, recordServiceCheck, serviceHeartbeat } from '@repo/db';
import { and, eq, like, lt, ne, sql } from 'drizzle-orm';
import { engineExecutorId, engineRunning } from './dbos';
import { signalFinishedAgentRuns, startLostRuns } from './runs';
import { reconcileEngineSchedules } from './schedules';

// The engine's own background passes, run by the api's background jobs. The quick pass
// wakes runs whose agent runs finished, starts runs whose start was lost and reports
// the engine alive. The maintenance pass
// keeps the engine's schedules in step with Helena's, hands the pending runs of an
// executor that is gone to the others, and prunes skipped routine fires.

// An executor unseen this long is gone: its pending runs are resumed by the others.
const EXECUTOR_GONE_MS = 5 * 60_000;

// Missed and task-open fires of routines are kept this long; every other run stays.
const SKIPPED_RETENTION_DAYS = 90;

export async function engineTick(): Promise<void> {
  if (!engineRunning()) return;
  await recordServiceCheck('engine', null);
  await recordServiceCheck(`engine:${engineExecutorId()}`, null);
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

// Answers how much it changed, for the health overview.
export async function engineMaintenance(): Promise<number> {
  if (!engineRunning()) return 0;
  return (
    (await reconcileEngineSchedules()) + (await recoverGoneExecutors()) + (await pruneSkippedRuns())
  );
}
