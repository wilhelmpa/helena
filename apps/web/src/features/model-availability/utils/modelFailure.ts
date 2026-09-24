import type { AiChatModel, UnavailableChatModel } from '@/lib/api/endpoints/agentChat';
import type { RunFailureRef } from '@/lib/api/endpoints/modelAvailability';

// Reading what Helena learned about the models (docs/helena-decisions/model-availability.md)
// for the views that word it: which account a provider or runtime stands for, whether a
// failure is one of a refused model, and what a template copy fell back from.

// The subscription behind a provider or runtime, for "dein ChatGPT-Konto": Codex and Hermes'
// openai-codex sign in to ChatGPT, Claude Code and Hermes' anthropic to Claude.
export type ModelAccount = 'chatgpt' | 'claude' | 'other';

export function accountOf(
  provider?: string | null,
  runtime?: string | null,
  model?: string | null,
): ModelAccount {
  const key = provider?.trim() || (runtime && runtime !== 'hermes' ? runtime.trim() : '');
  if (key === 'openai-codex' || key === 'openai' || key === 'codex') return 'chatgpt';
  if (key === 'anthropic' || key === 'claude') return 'claude';
  if (key) return 'other';
  // Where only the model is known (a failed stage), its family names the subscription.
  const id = model?.trim().toLowerCase().replace(/^.*\//, '') ?? '';
  if (/^(gpt|o\d)/.test(id)) return 'chatgpt';
  if (/^(claude|opus|sonnet|haiku|fable)\b/.test(id)) return 'claude';
  return 'other';
}

export function isModelRefusal(failure: RunFailureRef | null | undefined): boolean {
  return failure?.code === 'model-unavailable';
}

// A failure Helena words itself: a refused model, or a refusal no retry passes.
export function knownFailure(
  failure: RunFailureRef | null | undefined,
): 'modelUnavailable' | 'providerRejected' | null {
  if (failure?.code === 'model-unavailable') return 'modelUnavailable';
  if (failure?.code === 'provider-rejected') return 'providerRejected';
  return null;
}

// The refusal on record for a model the agent is set to, from its catalog.
export function refusalOf(
  model: string | null | undefined,
  unavailable: UnavailableChatModel[] | undefined,
): UnavailableChatModel | undefined {
  if (!model) return undefined;
  return unavailable?.find((entry) => entry.id === model);
}

// A copy that runs on the runtime's default because its template's model was refused: the
// template's model, or null when the copy has a model of its own or the template's works.
export function templateFallbackModel(
  copy: { model: string | null; sourceTemplateId: number | null },
  template: { model: string | null } | undefined,
  unavailable: UnavailableChatModel[] | undefined,
): string | null {
  if (copy.sourceTemplateId == null || copy.model || !template?.model) return null;
  return refusalOf(template.model, unavailable) ? template.model : null;
}

// A model only the runtime expects to work (the account's list does not name it, and no use
// confirmed it yet): the pickers mark it.
export function isUnverified(model: Pick<AiChatModel, 'verified'>): boolean {
  return model.verified === false;
}
