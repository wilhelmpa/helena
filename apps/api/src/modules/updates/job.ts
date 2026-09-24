import { registerSystemJob, type SystemJobContext } from '#modules/engine/system-jobs';
import { collectDigests, queueDigests, runUpdateCheck } from './service';
import { getUpdateSettings } from './settings';

// The update center's job on the engine (owner, 2026-09-24: "regelmäßig nach Updates
// suchen"): check every source, queue a digest run for each new version, wait for the runs
// and store what they wrote. Scheduled in the settings (daily at 06:00 Europe/Berlin by
// default) and started by "Jetzt prüfen".

export const UPDATES_JOB_ID = 'helena.updates';

// How long the job waits for the summaries before it ends; a run still going then is read
// at the next check (its rows stay "wird zusammengefasst").
const DIGEST_WAIT_MS = 45 * 60_000;
const DIGEST_POLL_MS = 20_000;

export async function runUpdatesJob(context: SystemJobContext): Promise<void> {
  await context.step('check', () => runUpdateCheck({ manual: context.trigger === 'manual' }));
  await context.step('digest:queue', () => queueDigests());
  let open = await context.step('digest:collect', () => collectDigests());
  for (let round = 0; open > 0 && round * DIGEST_POLL_MS < DIGEST_WAIT_MS; round++) {
    await context.sleep(DIGEST_POLL_MS);
    open = await context.step(`digest:collect:${round}`, () => collectDigests());
  }
}

registerSystemJob({
  id: UPDATES_JOB_ID,
  async schedule() {
    const settings = await getUpdateSettings();
    return { enabled: settings.enabled, cron: settings.cron, timezone: settings.timezone };
  },
  run: runUpdatesJob,
});
