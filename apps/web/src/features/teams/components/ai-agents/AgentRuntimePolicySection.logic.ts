import type { AiChatModel } from '@/lib/api/endpoints/agentChat';

// A model owns its reasoning levels. Keep a level only when the newly selected
// model advertises it; choosing the agent default also delegates reasoning to
// the runner.
export function runtimeSelectionForModel(
  models: AiChatModel[],
  model: string | null,
  reasoningEffort: string | null,
) {
  if (model === null) return { model: null, reasoningEffort: null };
  const selected = models.find((entry) => entry.id === model);
  return {
    model,
    reasoningEffort:
      reasoningEffort && selected?.thinkingLevels.includes(reasoningEffort)
        ? reasoningEffort
        : null,
  };
}
