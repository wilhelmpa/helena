import { recordJanitorRun } from '@repo/db';
import { intEnv } from '#shared/lib';
import { JANITOR_JOBS } from '#modules/god/system-health';
import { agentRunConfig } from '#modules/agents/core/run-queue';
import { processAgentRuns } from '#modules/agents/core/run-poller';
import { expireExhaustedRuns, expireResumeLimitedRuns } from '#modules/agents/runner/service';
import { sweepStaleIssues } from '#modules/issues/auto-archive';
import { processActionRuns } from '#modules/actions/runner';
import { processInboxTasks } from '#modules/hub-inbox/tasks';
import { processAgentTeamStarts } from '#modules/control-plane-workflows/agent-team-starts';
import { reconcileWorkflowSchedules } from '#modules/control-plane-workflows/service';
import { cancelOrphanedStageRuns } from './hermes-team-control';
import { drainPendingStarts } from '#modules/pipelines/runs';
import { prunePolicyDecisions } from '#modules/autopilot/engine';

const [RUN_JANITOR, STAGE_JANITOR, WORKFLOW_SCHEDULES, RESUME_JANITOR] = JANITOR_JOBS;

// The api's background jobs, started by index.ts rather than assembled into the app,
// so importing the app in a test starts nothing. Several api replicas run them without
// overlapping: the queue is claimed with FOR UPDATE SKIP LOCKED, and the sweep only
// touches rows it has not archived yet.

// Each job gets a loop of its own. A run is an LLM call of minutes and a first sweep
// can carry thousands of issues, so sharing one loop would let either hold the other
// back for that long.
export function startBackgroundJobs(): void {
  startLoop('agent-runs', processAgentRuns, agentRunConfig.pollIntervalMs);
  startLoop('action-runs', processActionRuns, () => intEnv('ACTION_RUN_POLL_INTERVAL_MS', 1000));
  startLoop('inbox-tasks', processInboxTasks, () => intEnv('INBOX_TASK_POLL_INTERVAL_MS', 2000));
  startLoop('pipeline-starts', drainPendingStarts, () =>
    intEnv('PIPELINE_START_POLL_INTERVAL_MS', 2000),
  );
  // Archiving is not time-sensitive, so the sweep runs far less often than the queue
  // is drained.
  startLoop('auto-archive', autoArchive, () => intEnv('AUTO_ARCHIVE_INTERVAL_MS', 3_600_000));
  startLoop('agent-team-starts', processAgentTeamStarts, () =>
    intEnv('AGENT_TEAM_START_POLL_INTERVAL_MS', 5_000),
  );
  startLoop(RUN_JANITOR, runJanitor, () => intEnv('RUN_JANITOR_INTERVAL_MS', 60_000));
  startLoop(STAGE_JANITOR, stageJanitor, () => intEnv('STAGE_JANITOR_INTERVAL_MS', 300_000));
  startLoop(WORKFLOW_SCHEDULES, syncSchedules, () =>
    intEnv('WORKFLOW_SCHEDULE_SYNC_INTERVAL_MS', 600_000),
  );
  startLoop(RESUME_JANITOR, resumeJanitor, () => intEnv('RESUME_JANITOR_INTERVAL_MS', 60_000));
  // The Autopilot's decision log keeps HELENA_POLICY_LOG_DAYS (90) days.
  startLoop(
    'policy-log',
    async () => void (await prunePolicyDecisions()),
    () => intEnv('HELENA_POLICY_LOG_PRUNE_INTERVAL_MS', 86_400_000),
  );
}

// Runs one janitor job and records what the health overview shows of it: how much it
// cleaned up on a run that finished, or why it failed on one that did not. The count
// stays at the last successful run's while a failure is recorded, so a janitor that
// started throwing does not look like it suddenly found nothing to do. Rethrows so
// `startLoop` still logs the failure the way it always has.
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

export async function stageJanitor(): Promise<void> {
  const canceled = await janitorJob(STAGE_JANITOR, cancelOrphanedStageRuns);
  if (canceled > 0)
    console.log(`[background] canceled ${canceled} stage runs Mastra no longer waits for`);
}

export async function syncSchedules(): Promise<void> {
  const changed = await janitorJob(WORKFLOW_SCHEDULES, reconcileWorkflowSchedules);
  if (changed > 0)
    console.log(`[background] brought ${changed} workflow schedules in line with Plan`);
}

// Ends a run that kept resuming past the instance's limit: it would otherwise sit
// pending, its lease renewing it into claimable again without ever being claimed, since
// claimRunnerRun already refuses it.
export async function resumeJanitor(): Promise<void> {
  const failed = await janitorJob(RESUME_JANITOR, expireResumeLimitedRuns);
  if (failed > 0) console.log(`[background] failed ${failed} runs that reached the resume limit`);
}

async function autoArchive(): Promise<void> {
  const archived = await sweepStaleIssues();
  if (archived > 0) console.log(`[background] auto-archived ${archived} stale issues`);
}

function startLoop(name: string, job: () => Promise<void>, intervalMs: () => number): void {
  const tick = async () => {
    try {
      await job();
    } catch (error) {
      console.error(`[background] ${name} failed:`, error);
    }
    setTimeout(tick, intervalMs()).unref();
  };
  void tick();
}
