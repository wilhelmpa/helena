import type { DynamicToolUIPart, ProviderMetadata } from 'ai';

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
  if (!resolved && typeof exitCode === 'number') resolved = exitCode === 0 ? 'ok' : 'error';
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

export function toolResultFailed(result: {
  isError?: boolean;
  outcome?: ToolOutcome;
  exitCode?: number | null;
}): boolean {
  return (
    result.isError === true ||
    result.outcome === 'error' ||
    result.outcome === 'nonzero_with_output' ||
    (typeof result.exitCode === 'number' && result.exitCode !== 0)
  );
}
