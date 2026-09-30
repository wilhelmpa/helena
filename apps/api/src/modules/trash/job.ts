import { randomUUID } from 'node:crypto';
import { registerSystemJob, type SystemJobContext } from '#modules/engine/system-jobs';
import { emptyTrash } from './service';

export const TRASH_JOB_ID = 'volition.trash-cleanup';

export async function runTrashCleanup(context: SystemJobContext) {
  const now = await context.step('date', async () =>
    (context.scheduledFor ?? new Date()).toISOString(),
  );
  const batchId = await context.step('batch', async () => randomUUID());
  await context.step('purge', () => emptyTrash({ automatic: true, now: new Date(now), batchId }));
}

registerSystemJob({
  id: TRASH_JOB_ID,
  schedule: async () => ({ enabled: true, cron: '30 3 * * *', timezone: 'Europe/Berlin' }),
  run: runTrashCleanup,
});
