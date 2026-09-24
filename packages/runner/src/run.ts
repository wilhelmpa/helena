import { setTimeout as sleep } from 'node:timers/promises';
import { AnswerStream, FinalAnswerReader, UsageReader } from './agui';
import { isTransient, RequestError, type Client, type ReflectionRequest, type Run } from './client';
import type { RunnerConfig } from './config';
import { execute, modelProvider, type Outcome } from './execute';
import { LoginUseReader } from './logins';
import type { HermesRunSettings } from './policy';
import { runnerRedactor } from './readers/context';
import { Redactor } from './redact';
import { runModelReport, type RuntimeAdapter } from './runtime';
import { SpendReader } from './spend';
import { observeLimits } from './limits/context';
import { runCwd } from './workdir';

// `stop` is aborted when the heartbeat says the run was canceled or is no longer this
// runner's, and when the runner stops. The command is killed and nothing is reported.
// `lost` is aborted only in the first case, which is the one that ends a report.

// The waits between attempts to report a result the server did not take, and how often a
// server error is taken as passing (about ten minutes of them) before it counts as the
// answer.
const REPORT_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const SERVER_ERROR_RETRIES = 20;
// How often the run's timeline in Helena receives what the command wrote since.
const EVENTS_FLUSH_MS = 1_000;

// The secrets a run's command was handed, which its timeline must not show: the runner's own
// and the MCP secrets of this run.
export function runRedactor(config: RunnerConfig, env: Record<string, string>): Redactor {
  const mcpSecrets = Object.entries(env)
    .filter(([name]) => name.startsWith('ITSAPLAN_MCP_SECRET_'))
    .map(([, value]) => value);
  return new Redactor([...runnerRedactor(config).secrets(), ...mcpSecrets]);
}

// The command's output as AG-UI events for the run's timeline in Helena, redacted, while the
// run runs. A batch that fails is carried by the next flush; the timeline is a view, so a
// server that takes none of it does not fail the run.
function runTimeline(
  config: RunnerConfig,
  client: Client,
  run: Run,
  redactor: Redactor,
): { stream: AnswerStream; stop: () => void } {
  const stream = new AnswerStream(
    config.outputFormat,
    `run-${run.id}`,
    String(run.id),
    async (events) => {
      await client.runEvents(run.id, run.claim, await redactor.value(events));
    },
  );
  const timer = setInterval(() => {
    void stream.flush().catch(() => {});
  }, EVENTS_FLUSH_MS);
  return { stream, stop: () => clearInterval(timer) };
}

export function runEnv(run: Run): Record<string, string> {
  return {
    ITSAPLAN_RUN_ID: String(run.id),
    ITSAPLAN_TRIGGER: run.trigger,
    ITSAPLAN_SYSTEM_PROMPT: run.systemPrompt,
    ITSAPLAN_ISSUE: run.issueIdentifier ?? '',
    ITSAPLAN_ISSUE_ID: run.issueId == null ? '' : String(run.issueId),
    // Set when this run is resuming: an operator command with no preset can use it to
    // pick its own session back up, the way the preset commands already do through
    // their --resume flag.
    ITSAPLAN_SESSION_ID: run.sessionId ?? '',
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

// A runtime without a file for the agent's standing instructions gets them in front of the
// run's own context, once per session: a resumed session already holds them.
export function withInstructions(
  instructions: string | undefined,
  systemPrompt: string,
  sessionId: string | null | undefined,
): string {
  if (!instructions || sessionId) return systemPrompt;
  return systemPrompt ? `${instructions}\n\n${systemPrompt}` : instructions;
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
    // The runtime adapter, which says what model the session really ran on.
    runtime?: RuntimeAdapter | null;
  } = {},
): Promise<Performed | null> {
  // Read as the command writes, not off the outcome: only the tail of the output is
  // kept, and the line carrying the counts can fall outside it. A command that reports
  // the totals of the run has them on the outcome, and those are what the run cost.
  const usage = new UsageReader(config.outputFormat);
  const spend = new SpendReader(
    config.outputFormat,
    config.command ? null : (config.agent ?? null),
  );
  const logins = new LoginUseReader(hermes?.logins ?? new Map());
  // Plan limits the runtime's output shows (Claude Code's rate_limit_event), sent as they move.
  const limits = observeLimits(config, options.runtime ?? null, client);
  const task = taskOf(run);
  const saveSession = (sessionId: string) => {
    // Best effort, and never allowed to disrupt reading the run's own output: a
    // client that cannot take this report, or a server that predates the route,
    // is not fatal to the run.
    try {
      void client.reportSession(run.id, run.claim, sessionId).catch(() => {});
    } catch {
      // Ignored for the same reason.
    }
  };
  const answer = new FinalAnswerReader(config.outputFormat, saveSession);
  const timeline = runTimeline(config, client, run, runRedactor(config, hermes?.env ?? {}));
  // Reported as soon as it is known, not only with the result: a crash before the run
  // reports keeps this session for the next claim to resume. Best effort -- a stale
  // claim or a server that predates this route is not fatal to the run itself.
  const outcome = await execute(
    {
      ...config,
      cwd: runCwd(config.cwd, run.workdir),
      args: [...config.args, ...(hermes?.args ?? [])],
    },
    {
      ...task,
      systemPrompt: withInstructions(hermes?.instructions, task.systemPrompt, task.sessionId),
      toolsets: hermes?.toolsets ?? null,
      env: { ...task.env, ...hermes?.env },
      hooks: hermes?.hooks,
    },
    {
      onData: (chunk) => {
        usage.write(chunk);
        spend.write(chunk);
        logins.write(chunk);
        answer.write(chunk);
        timeline.stream.write(chunk);
        limits?.write(chunk);
      },
      onSessionId: saveSession,
      signal: stop.signal,
      work: { kind: 'run', id: run.id },
    },
  );
  timeline.stop();
  await limits?.end();
  if (stop.signal.aborted) {
    await timeline.stream.fail('The run was stopped').catch(() => {});
    return null;
  }
  usage.end();
  answer.end();
  await (
    outcome.status === 'success'
      ? timeline.stream.finish(outcome.output)
      : timeline.stream.fail(outcome.error ?? 'The run failed', outcome.output)
  ).catch(() => {});
  const uses = logins.uses();
  // The audit log misses these uses when the report fails; the run itself does not.
  if (uses.length > 0) await client.reportLoginUses({ runId: run.id }, uses).catch(() => {});
  const sessionId = outcome.sessionId ?? answer.sessionId() ?? undefined;
  const runtime = await runModelReport(
    options.runtime ?? null,
    { model: run.model, reasoning: run.thinkingLevel },
    sessionId,
    usage.model(),
  );
  const result = {
    ...outcome,
    // The answer itself, where the command prints an event stream (Claude Code, Codex).
    output: answer.text() ?? outcome.output,
    usage: outcome.usage ?? usage.value(),
    spend: spend.value({ model: run.model, provider: modelProvider(config, run.model) ?? null }),
    ...(sessionId && { sessionId }),
    ...(runtime && { runtime }),
  };
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
