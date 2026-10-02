import type { DynamicToolUIPart, ProviderMetadata } from 'ai';

// How a tool call ended, as Ava's runtime reports it (`outcome` and `exitCode` of the
// result): a shell command that exits non-zero is not a failure of the tool — the agent
// reads its output — so it is shown neutrally as "ended with code N", never as "done";
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
  let resolved = outcome;
  if (!resolved && typeof exitCode === 'number')
    resolved = exitCode === 0 ? 'ok' : 'nonzero_with_output';
  if (!resolved || !OUTCOMES.includes(resolved)) return undefined;
  return { [KEY]: { outcome: resolved, exitCode: exitCode ?? null } };
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

// A failed tool call (red). A non-zero exit is not one, even if an older runner marked
// it `isError`.
export function toolResultFailed(result: {
  isError?: boolean;
  outcome?: ToolOutcome;
  exitCode?: number | null;
}): boolean {
  if (result.outcome === 'nonzero_with_output') return false;
  return result.isError === true || result.outcome === 'error';
}

// A command that ended with a non-zero code: shown as "ended with code N".
export function exitedNonzero(result: { outcome?: ToolOutcome; exitCode?: number | null }) {
  return (
    result.outcome === 'nonzero_with_output' ||
    (result.outcome !== 'error' && typeof result.exitCode === 'number' && result.exitCode !== 0)
  );
}
