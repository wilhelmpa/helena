import type { AiChatModel } from '@/lib/api/endpoints/agentChat';

export function settingsForModel(
  models: AiChatModel[],
  model: string | null,
  thinkingLevel: string | null,
) {
  if (model === null) return { model: null, thinkingLevel: null };
  const selected = models.find((entry) => entry.id === model);
  return {
    model,
    thinkingLevel:
      thinkingLevel && selected?.thinkingLevels.includes(thinkingLevel) ? thinkingLevel : null,
  };
}
