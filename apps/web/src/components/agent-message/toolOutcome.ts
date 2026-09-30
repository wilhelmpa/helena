import type { DynamicToolUIPart, ProviderMetadata } from 'ai';

// How a tool call ended, as Ava's runtime reports it (`outcome` and `exitCode` of the
// result): a shell command that exits non-zero but printed output is not a failure of
// the tool — the agent reads the output — so it is shown neutrally, with its exit code;
// only `error` is red.
export type ToolOutcome = 'ok' | 'nonzero_with_output' | 'error';

const KEY = 'ava';

export interface ToolOutcomeInfo {
  outcome: ToolOutcome;
  exitCode: number | null;
}

const OUTCOMES: readonly string[] = ['ok', 'nonzero_with_output', 'error'];

// The result's outcome as the provider metadata the AI SDK keeps on a finished tool part
// (`resultProviderMetadata`), so it travels with the part through the stream and the
// stored transcript alike.
export function outcomeMetadata(
  outcome: ToolOutcome | null | undefined,
  exitCode: number | null | undefined,
): ProviderMetadata | undefined {
  if (!outcome || !OUTCOMES.includes(outcome)) return undefined;
  return { [KEY]: { outcome, exitCode: exitCode ?? null } };
}

export function toolOutcome(tool: DynamicToolUIPart): ToolOutcomeInfo | null {
  const raw =
    'resultProviderMetadata' in tool
      ? (tool.resultProviderMetadata as ProviderMetadata | undefined)?.[KEY]
      : undefined;
  if (!raw || typeof raw.outcome !== 'string' || !OUTCOMES.includes(raw.outcome)) return null;
  return {
    outcome: raw.outcome as ToolOutcome,
    exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : null,
  };
}

// A command that ended with a non-zero code but produced output: shown as "ended with
// code N", not as a failure.
export const isNeutralExit = (tool: DynamicToolUIPart) =>
  toolOutcome(tool)?.outcome === 'nonzero_with_output';
