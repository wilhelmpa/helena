import { intEnv } from '#shared/lib';
import { agentRunConfig } from '#modules/agents/core/run-queue';
import { expireExhaustedRuns } from '#modules/agents/runner/service';
import { processAgentTeamStarts } from '#modules/control-plane-workflows/agent-team-starts';
import { reconcileWorkflowSchedules } from '#modules/control-plane-workflows/service';
import { cancelOrphanedStageRuns } from './hermes-team-control';
import { processAgentRuns } from '#modules/agents/core/run-poller';
import { sweepStaleIssues } from '#modules/issues/auto-archive';
import { processActionRuns } from '#modules/actions/runner';
import { processInboxTasks } from '#modules/hub-inbox/tasks';

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
  // Archiving is not time-sensitive, so the sweep runs far less often than the queue
  // is drained.
  startLoop('auto-archive', autoArchive, () => intEnv('AUTO_ARCHIVE_INTERVAL_MS', 3_600_000));
  startLoop('agent-team-starts', processAgentTeamStarts, () =>
    intEnv('AGENT_TEAM_START_POLL_INTERVAL_MS', 5_000),
  );
  startLoop('run-janitor', runJanitor, () => intEnv('RUN_JANITOR_INTERVAL_MS', 60_000));
  startLoop('stage-janitor', stageJanitor, () => intEnv('STAGE_JANITOR_INTERVAL_MS', 300_000));
  startLoop('workflow-schedules', syncSchedules, () =>
    intEnv('WORKFLOW_SCHEDULE_SYNC_INTERVAL_MS', 600_000),
  );
}

// Ends what nobody else ends: a run of an external agent whose runner stopped reporting
// is otherwise failed only when that agent's runner claims again.
async function runJanitor(): Promise<void> {
  const failed = await expireExhaustedRuns();
  if (failed > 0) console.log(`[background] failed ${failed} runs their runner did not finish`);
}

async function stageJanitor(): Promise<void> {
  const canceled = await cancelOrphanedStageRuns();
  if (canceled > 0)
    console.log(`[background] canceled ${canceled} stage runs Mastra no longer waits for`);
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

async function syncSchedules(): Promise<void> {
  const changed = await reconcileWorkflowSchedules();
  if (changed > 0)
    console.log(`[background] brought ${changed} workflow schedules in line with Plan`);
}
