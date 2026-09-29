import { resumeGlobalModel } from '#modules/local-ai/global-model';
import { startLoop } from '@helena/loop';
import { recordJanitorRun } from '@repo/db';
import { intEnv } from '#shared/lib';
import { JANITOR_JOBS } from '#modules/god/system-health';
import { expireExhaustedRuns, expireResumeLimitedRuns } from '#modules/agents/runner/service';
import { sweepStaleIssues } from '#modules/issues/auto-archive';
import { processActionRuns } from '#modules/actions/runner';
import { processInboxTasks } from '#modules/hub-inbox/tasks';
import { engineRunning, launchEngine } from '#modules/engine/dbos';
import { engineMaintenance, engineTick } from '#modules/engine/janitor';
import { processConnectorActions } from '#modules/connectors/tools';
import { pruneRuntimeRequests } from '#modules/agents/runtime-requests/service';
import { scheduleCuratorRuns } from '#modules/agents/runtime-requests/curator-schedule';
import { pruneRunEvents } from '#modules/agents/run-timeline/service';
import { scheduleLimitProbes } from '#modules/provider-limits/service';
import { prunePolicyDecisions } from '#modules/autopilot/engine';
import { checkAllServers } from '#modules/local-ai/service';
import { checkLocalAiGuard } from '#modules/local-ai/guard';
import { followActions } from '#modules/updates/service';
import { processPushDeliveries } from '@helena/push';
import { checkAlerts } from '#modules/push/alerts';
import { pruneExpiredSessions } from '@repo/auth';
import { processTelegramEvents } from '#modules/telegram/channel';

const [RUN_JANITOR, RESUME_JANITOR, ENGINE_MAINTENANCE, RUNTIME_JANITOR] = JANITOR_JOBS;

// The api's background jobs, started by index.ts rather than assembled into the app,
// so importing the app in a test starts nothing. Several api replicas run them without
// overlapping: the queues are claimed with FOR UPDATE SKIP LOCKED, and the sweep only
// touches rows it has not archived yet. The Helena engine (workflows, agent teams,
// routines and their schedules) runs here too; HELENA_ENGINE=off leaves it out of a
// replica.

// Each job gets a loop of its own, so a long tick of one holds no other back.
export function startBackgroundJobs(): void {
  startLoop('action-runs', processActionRuns, () => intEnv('ACTION_RUN_POLL_INTERVAL_MS', 1000));
  startLoop('inbox-tasks', processInboxTasks, () => intEnv('INBOX_TASK_POLL_INTERVAL_MS', 2000));
  startLoop('telegram-events', processTelegramEvents, () => intEnv('TELEGRAM_EVENT_POLL_MS', 2000));
  // Archiving is not time-sensitive, so the sweep runs far less often than the queue
  // is drained.
  startLoop('auto-archive', autoArchive, () => intEnv('AUTO_ARCHIVE_INTERVAL_MS', 3_600_000));
  // Connector actions the owner approved run within seconds of the decision.
  startLoop(
    'connector-actions',
    async () => void (await processConnectorActions()),
    () => intEnv('CONNECTOR_ACTION_POLL_INTERVAL_MS', 3_000),
  );
  startLoop(RUN_JANITOR, runJanitor, () => intEnv('RUN_JANITOR_INTERVAL_MS', 60_000));
  startLoop(RESUME_JANITOR, resumeJanitor, () => intEnv('RESUME_JANITOR_INTERVAL_MS', 60_000));
  startLoop(RUNTIME_JANITOR, runtimeJanitor, () => intEnv('RUNTIME_JANITOR_INTERVAL_MS', 300_000));
  // Plan limits: the spool every minute, the runners once per the owner's interval.
  startLoop(
    'provider-limits',
    async () => void (await scheduleLimitProbes()),
    () => intEnv('PROVIDER_LIMITS_TICK_MS', 60_000),
  );
  // Updates the owner started (the update center): followed to their end even while
  // nobody has the page open.
  startLoop(
    'update-actions',
    async () => void (await followActions()),
    () => intEnv('HELENA_UPDATE_FOLLOW_MS', 10_000),
  );
  // Push (docs/helena-decisions/push.md): the alert sources are watched from here, so an
  // emergency reaches the owner's phone while nobody has Helena open; the push rows of the
  // outbox are sent from here as well as from the worker, so they go out while either is down.
  startLoop(
    'push-alerts',
    async () => void (await checkAlerts()),
    () => intEnv('HELENA_PUSH_ALERT_INTERVAL_MS', 60_000),
  );
  startLoop(
    'push-deliveries',
    async () => void (await processPushDeliveries()),
    () => intEnv('HELENA_PUSH_POLL_INTERVAL_MS', 2_000),
  );
  // The Autopilot's decision log keeps HELENA_POLICY_LOG_DAYS (90) days.
  startLoop(
    'policy-log',
    async () => void (await prunePolicyDecisions()),
    () => intEnv('HELENA_POLICY_LOG_PRUNE_INTERVAL_MS', 86_400_000),
  );
  startLoop(
    'model-maintenance',
    async () => {
      await resumeGlobalModel();
    },
    () => 2_000,
  );
  startLoop('local-ai-guard', checkLocalAiGuard, () => 60_000);
  // Expired sign-in sessions, which better-auth only removes when they are used again.
  startLoop(
    'session-prune',
    async () => {
      const removed = await pruneExpiredSessions();
      if (removed > 0) console.log(`[background] removed ${removed} expired sessions`);
    },
    () => intEnv('HELENA_SESSION_PRUNE_INTERVAL_MS', 3_600_000),
  );
  if (process.env.HELENA_ENGINE?.trim().toLowerCase() === 'off') return;
  // Launches the engine and tries again while the database does not answer.
  const launcher = startLoop(
    'engine-launch',
    async () => {
      await launchEngine();
      launcher.stop();
      console.log('[engine] running');
    },
    () => 15_000,
  );
  // Local AI: each enabled model server's status and models, for the routes and the card.
  startLoop('local-ai-servers', checkAllServers, () => intEnv('HELENA_LOCAL_AI_CHECK_MS', 60_000));
  startLoop('engine', engineTick, () => intEnv('HELENA_ENGINE_TICK_MS', 3_000));
  startLoop(ENGINE_MAINTENANCE, maintainEngine, () =>
    intEnv('HELENA_ENGINE_MAINTENANCE_MS', 300_000),
  );
}

// Runs one janitor job and records what the health overview shows of it: how much it
// cleaned up on a run that finished, or why it failed on one that did not. The count
// stays at the last successful run's while a failure is recorded, so a janitor that
// started throwing does not look like it suddenly found nothing to do. Rethrows so
// the loop still logs the failure.
export async function janitorJob(
  job: (typeof JANITOR_JOBS)[number],
  run: () => Promise<number>,
): Promise<number> {
  try {
    const cleaned = await run();
    await recordJanitorRun(job, cleaned, null);
    return cleaned;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJanitorRun(job, null, message).catch(() => {});
    throw error;
  }
}

// Ends what nobody else ends: a run of an external agent whose runner stopped reporting
// is otherwise failed only when that agent's runner claims again.
export async function runJanitor(): Promise<void> {
  const failed = await janitorJob(RUN_JANITOR, expireExhaustedRuns);
  if (failed > 0) console.log(`[background] failed ${failed} runs their runner did not finish`);
}

// Ends a run that kept resuming past the instance's limit: it would otherwise sit
// pending, its lease renewing it into claimable again without ever being claimed, since
// claimRunnerRun already refuses it.
export async function resumeJanitor(): Promise<void> {
  const failed = await janitorJob(RESUME_JANITOR, expireResumeLimitedRuns);
  if (failed > 0) console.log(`[background] failed ${failed} runs that reached the resume limit`);
}

// The engine's maintenance: the runs of a replica that is gone resumed elsewhere, its
// old records and skipped fires pruned.
export async function maintainEngine(): Promise<void> {
  if (!engineRunning()) return;
  const changed = await janitorJob(ENGINE_MAINTENANCE, engineMaintenance);
  if (changed > 0) console.log(`[engine] maintenance changed ${changed} runs or records`);
}

// Removes the answered and stale questions to agents' runtimes and the timelines of runs
// that finished long ago, and asks the curators that are due for their review.
export async function runtimeJanitor(): Promise<void> {
  await janitorJob(
    RUNTIME_JANITOR,
    async () =>
      (await pruneRuntimeRequests()) + (await pruneRunEvents()) + (await scheduleCuratorRuns()),
  );
}

async function autoArchive(): Promise<void> {
  const archived = await sweepStaleIssues();
  if (archived > 0) console.log(`[background] auto-archived ${archived} stale issues`);
}
