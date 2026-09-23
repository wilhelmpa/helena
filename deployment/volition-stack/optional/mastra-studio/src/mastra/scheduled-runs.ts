import type { Mastra } from '@mastra/core/mastra';
import type { WorkEnvelope } from './contracts.ts';

// Mastra names the run of a schedule fire `sched_<scheduleId>_<fire time in ms>`, for a
// cron fire and for a manual run alike.
const FIRE_RUN_ID = /^sched_(.+)_(\d+)$/;

export function scheduleFire(runId: string): { scheduleId: string; firedAt: number } | null {
  const match = FIRE_RUN_ID.exec(runId);
  return match ? { scheduleId: match[1], firedAt: Number(match[2]) } : null;
}

// Every fire of a schedule starts with the input stored on the schedule, so the event
// id, correlation id and time of a fire come from its run id. A run started directly
// keeps its envelope, whose event id is already its run id.
export function fireEnvelope(envelope: WorkEnvelope, runId: string): WorkEnvelope {
  const fire = scheduleFire(runId);
  if (!fire) return envelope;
  return {
    ...envelope,
    eventId: runId,
    correlationId: runId,
    occurredAt: new Date(fire.firedAt).toISOString(),
  };
}

// The output of a finished run. The evented engine, which runs schedule fires, stores
// the result record of the last step as the run result; the default engine stores the
// output itself.
export function runOutput(result: unknown): unknown {
  return result && typeof result === 'object' && 'output' in result ? result.output : result;
}

// A schedule fire starts its run without a resource id, and Plan lists the runs of a
// project by it. The stored snapshot is written again with the project; later writes
// keep a resource id that is set.
export async function scopeRunToProject(
  mastra: Mastra | undefined,
  workflowName: string,
  runId: string,
  projectRef: string,
): Promise<void> {
  const store = await mastra?.getStorage()?.getStore('workflows');
  if (!store) return;
  const run = await store.getWorkflowRunById({ runId, workflowName });
  if (!run || run.resourceId) return;
  await store.persistWorkflowSnapshot({
    workflowName,
    runId,
    resourceId: projectRef,
    snapshot: typeof run.snapshot === 'string' ? JSON.parse(run.snapshot) : run.snapshot,
  });
}
