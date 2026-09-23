import { UsageReader } from './agui';
import type { Client, Run } from './client';
import type { RunnerConfig } from './config';
import { execute, type Outcome } from './execute';
import { LoginUseReader } from './logins';
import type { HermesRunSettings } from './policy';

// `stop` is aborted when the heartbeat says the run was canceled. The server has already
// closed the run by then, so the command is killed and nothing is reported for it.

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
): Promise<Outcome | null> {
  // Read as the command writes, not off the outcome: only the tail of the output is
  // kept, and the line carrying the counts can fall outside it. A command that reports
  // the totals of the run has them on the outcome, and those are what the run cost.
  const usage = new UsageReader(config.outputFormat);
  const logins = new LoginUseReader(hermes?.logins ?? new Map());
  const task = taskOf(run);
  const outcome = await execute(
    config,
    { ...task, toolsets: hermes?.toolsets ?? null, env: { ...task.env, ...hermes?.env } },
    {
      onData: (chunk) => {
        usage.write(chunk);
        logins.write(chunk);
      },
      signal: stop.signal,
    },
  );
  if (stop.signal.aborted) return null;
  usage.end();
  const uses = logins.uses();
  // The audit log misses these uses when the report fails; the run itself does not.
  if (uses.length > 0) await client.reportLoginUses({ runId: run.id }, uses).catch(() => {});
  await client.report(run.id, { ...outcome, usage: outcome.usage ?? usage.value() });
  return outcome;
}
