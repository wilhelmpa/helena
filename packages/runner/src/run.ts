import { setTimeout as sleep } from 'node:timers/promises';
import { UsageReader } from './agui';
import { isTransient, type Client, type Run } from './client';
import type { RunnerConfig } from './config';
import { execute, type Outcome } from './execute';
import type { HermesRunSettings } from './policy';
import { runCwd } from './workdir';

// `stop` is aborted when the heartbeat says the run was canceled or is no longer this
// runner's, and when the runner stops. The command is killed and nothing is reported.

// The waits between attempts to report a result the server did not take.
const REPORT_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

function taskOf(run: Run) {
  return {
    prompt: run.prompt,
    systemPrompt: run.systemPrompt,
    model: run.model,
    thinkingLevel: run.thinkingLevel,
    maxTurns: run.maxTurns,
    runBudgetSeconds: run.runBudgetSeconds,
    env: {
      ITSAPLAN_RUN_ID: String(run.id),
      ITSAPLAN_TRIGGER: run.trigger,
      ITSAPLAN_SYSTEM_PROMPT: run.systemPrompt,
      ITSAPLAN_ISSUE: run.issueIdentifier ?? '',
      ITSAPLAN_ISSUE_ID: run.issueId == null ? '' : String(run.issueId),
    },
  };
}

// Null when the run was canceled.
export async function perform(
  config: RunnerConfig,
  client: Client,
  run: Run,
  stop: AbortController,
  hermes: HermesRunSettings | null = null,
  wait?: (ms: number, signal: AbortSignal) => Promise<unknown>,
): Promise<Outcome | null> {
  // Read as the command writes, not off the outcome: only the tail of the output is
  // kept, and the line carrying the counts can fall outside it. A command that reports
  // the totals of the run has them on the outcome, and those are what the run cost.
  const usage = new UsageReader(config.outputFormat);
  const task = taskOf(run);
  const outcome = await execute(
    { ...config, cwd: runCwd(config.cwd, run.workdir) },
    { ...task, toolsets: hermes?.toolsets ?? null, env: { ...task.env, ...hermes?.env } },
    {
      onData: (chunk) => usage.write(chunk),
      signal: stop.signal,
    },
  );
  if (stop.signal.aborted) return null;
  usage.end();
  const result = { ...outcome, usage: outcome.usage ?? usage.value() };
  await reportUntilTaken(() => client.report(run.id, run.attempts, result), stop.signal, wait);
  return outcome;
}

// The command has done its work, so its result is sent again while the server cannot
// take it: a run left pending would be claimed and executed a second time once its lease
// runs out. The heartbeat keeps the lease meanwhile, and ends this by aborting `stop`
// when the run is no longer this runner's. A 4xx answer is final and thrown.
export async function reportUntilTaken(
  send: () => Promise<void>,
  stop: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) =>
    sleep(ms, undefined, { signal }),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (!isTransient(err) || stop.aborted) throw err;
      const delay = REPORT_RETRY_MS[Math.min(attempt, REPORT_RETRY_MS.length - 1)];
      await wait(delay, stop).catch(() => {});
    }
  }
}
