import type { Outcome } from './execute';
import type { Spend } from './spend';

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function externalResult(output: string, runtime: 'command' | 'webhook'): Outcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { status: 'success', output };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('output' in parsed)) {
    return { status: 'success', output };
  }
  const result = parsed as Record<string, unknown>;
  if (typeof result.output !== 'string') {
    return { status: 'failed', output: '', error: 'Adapter result output must be a string' };
  }
  const usage = result.usage;
  if (
    usage !== undefined &&
    (!usage ||
      typeof usage !== 'object' ||
      !count((usage as Record<string, unknown>).inputTokens) ||
      !count((usage as Record<string, unknown>).outputTokens))
  ) {
    return { status: 'failed', output: '', error: 'Adapter result usage is invalid' };
  }
  const rawSpend = result.spend;
  let spend: Spend | undefined;
  if (rawSpend !== undefined) {
    if (!rawSpend || typeof rawSpend !== 'object') {
      return { status: 'failed', output: '', error: 'Adapter result spend is invalid' };
    }
    const value = rawSpend as Record<string, unknown>;
    const keys = [
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'reasoningTokens',
    ] as const;
    if (keys.some((key) => !count(value[key]))) {
      return { status: 'failed', output: '', error: 'Adapter result spend is invalid' };
    }
    spend = {
      runtime,
      model: typeof value.model === 'string' ? value.model : null,
      provider: typeof value.provider === 'string' ? value.provider : null,
      inputTokens: value.inputTokens as number,
      outputTokens: value.outputTokens as number,
      cacheReadTokens: value.cacheReadTokens as number,
      cacheWriteTokens: value.cacheWriteTokens as number,
      reasoningTokens: value.reasoningTokens as number,
      durationMs: count(value.durationMs) ? value.durationMs : null,
    };
  }
  return {
    status: 'success',
    output: result.output,
    ...(usage && { usage: usage as { inputTokens: number; outputTokens: number } }),
    ...(spend && { spend }),
  };
}
