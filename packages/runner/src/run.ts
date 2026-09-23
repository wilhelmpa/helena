import { setTimeout as sleep } from 'node:timers/promises';
import { UsageReader } from './agui';
import { isTransient, RequestError, type Client, type ReflectionRequest, type Run } from './client';
import type { RunnerConfig } from './config';
import { execute, type Outcome } from './execute';
import { LoginUseReader } from './logins';
import type { HermesRunSettings } from './policy';
import { runCwd } from './workdir';

// `stop` is aborted when the heartbeat says the run was canceled or is no longer this
// runner's, and when the runner stops. The command is killed and nothing is reported.
// `lost` is aborted only in the first case, which is the one that ends a report.

// The waits between attempts to report a result the server did not take, and how often a
// server error is taken as passing (about ten minutes of them) before it counts as the
// answer.
const REPORT_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const SERVER_ERROR_RETRIES = 20;

export function runEnv(run: Run): Record<string, string> {
  return {
    ITSAPLAN_RUN_ID: String(run.id),
    ITSAPLAN_TRIGGER: run.trigger,
    ITSAPLAN_SYSTEM_PROMPT: run.systemPrompt,
    ITSAPLAN_ISSUE: run.issueIdentifier ?? '',
    ITSAPLAN_ISSUE_ID: run.issueId == null ? '' : String(run.issueId),
  };
}

function taskOf(run: Run) {
  return {
    prompt: run.prompt,
    systemPrompt: run.systemPrompt,
    // Set only when the server sent one: the run is being resumed after the runner
    // that held it before died mid run, and the command picks the session back up
    // instead of starting a new one.
    sessionId: run.sessionId ?? null,
    model: run.model,
    thinkingLevel: run.thinkingLevel,
    maxTurns: run.maxTurns,
    runBudgetSeconds: run.runBudgetSeconds,
    env: runEnv(run),
  };
}

export interface Performed {
  outcome: Outcome;
  // The reflection Plan asked for in its answer to the result.
  reflection: ReflectionRequest | null;
}

// Null when the run was canceled.
export async function perform(
  config: RunnerConfig,
  client: Client,
  run: Run,
  stop: AbortController,
  hermes: HermesRunSettings | null = null,
  options: {
    lost?: AbortSignal;
    wait?: (ms: number, signal: AbortSignal) => Promise<unknown>;
  } = {},
): Promise<Performed | null> {
  // Read as the command writes, not off the outcome: only the tail of the output is
  // kept, and the line carrying the counts can fall outside it. A command that reports
  // the totals of the run has them on the outcome, and those are what the run cost.
  const usage = new UsageReader(config.outputFormat);
  const logins = new LoginUseReader(hermes?.logins ?? new Map());
  const task = taskOf(run);
  // Reported as soon as it is known, not only with the result: a crash before the run
  // reports keeps this session for the next claim to resume. Best effort -- a stale
  // claim or a server that predates this route is not fatal to the run itself.
  const outcome = await execute(
    { ...config, cwd: runCwd(config.cwd, run.workdir) },
    { ...task, toolsets: hermes?.toolsets ?? null, env: { ...task.env, ...hermes?.env } },
    {
      onData: (chunk) => {
        usage.write(chunk);
        logins.write(chunk);
      },
      onSessionId: (sessionId) => {
        void client.reportSession(run.id, run.claim, sessionId).catch(() => {});
      },
      signal: stop.signal,
    },
  );
  if (stop.signal.aborted) return null;
  usage.end();
  const uses = logins.uses();
  // The audit log misses these uses when the report fails; the run itself does not.
  if (uses.length > 0) await client.reportLoginUses({ runId: run.id }, uses).catch(() => {});
  const result = { ...outcome, usage: outcome.usage ?? usage.value() };
  // A result sent under a claim this runner has since replaced is refused; it is sent
  // again under the new one.
  let reflection: ReflectionRequest | null = null;
  const send = async () => {
    const claim = run.claim;
    try {
      reflection = await client.report(run.id, claim, result);
    } catch (err) {
      if (err instanceof RequestError && err.status === 404 && claim !== run.claim)
        throw new Error('claimed again while reporting');
      throw err;
    }
  };
  await reportUntilTaken(send, options.lost ?? stop.signal, options.wait);
  return { outcome, reflection };
}

// The command has done its work, so its result is sent again while the server cannot
// take it: a run left pending would be claimed and executed a second time once its lease
// runs out. The heartbeat keeps the lease meanwhile, and ends this by aborting `lost`
// when the run is no longer this runner's. An unreachable server is waited for; a 4xx
// answer, and a server error that repeats, is final and thrown.
export async function reportUntilTaken(
  send: () => Promise<void>,
  lost: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) =>
    sleep(ms, undefined, { signal }),
): Promise<void> {
  let serverErrors = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (!isTransient(err) || lost.aborted) throw err;
      if (err instanceof RequestError && ++serverErrors > SERVER_ERROR_RETRIES) throw err;
      const delay = REPORT_RETRY_MS[Math.min(attempt, REPORT_RETRY_MS.length - 1)];
      await wait(delay, lost).catch(() => {});
    }
  }
}
