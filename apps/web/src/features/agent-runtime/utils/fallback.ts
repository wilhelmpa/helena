import type { FallbackModel } from '@/lib/api/endpoints/agents';

// The fallback entries worth saving: both halves filled, trimmed.
export function cleanFallbackModels(value: FallbackModel[]): FallbackModel[] {
  return value
    .map((entry) => ({ provider: entry.provider.trim(), model: entry.model.trim() }))
    .filter((entry) => entry.provider && entry.model);
}
