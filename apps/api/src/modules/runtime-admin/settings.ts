import { getSetting, setSetting } from '@repo/db';

// The instance's defaults for every agent runtime, set in Administrator: the models a
// runtime falls back to when an agent's own model fails and the agent names none itself, and
// how long Hermes keeps the sessions of ended runs and chats (their transcripts).

const KEY = 'agentRuntimeDefaults';

export interface FallbackModel {
  provider: string;
  model: string;
}

export interface AgentRuntimeDefaults {
  fallbackModels: FallbackModel[];
  // Null keeps Hermes' own default (90 days).
  sessionRetentionDays: number | null;
}

export async function getAgentRuntimeDefaults(): Promise<AgentRuntimeDefaults> {
  const stored = await getSetting<Partial<AgentRuntimeDefaults>>(KEY);
  return {
    fallbackModels: Array.isArray(stored?.fallbackModels) ? stored.fallbackModels : [],
    sessionRetentionDays:
      typeof stored?.sessionRetentionDays === 'number' ? stored.sessionRetentionDays : null,
  };
}

export async function setAgentRuntimeDefaults(
  patch: Partial<AgentRuntimeDefaults>,
): Promise<AgentRuntimeDefaults> {
  const next = { ...(await getAgentRuntimeDefaults()), ...patch };
  next.fallbackModels = next.fallbackModels
    .map((entry) => ({ provider: entry.provider.trim(), model: entry.model.trim() }))
    .filter((entry) => entry.provider && entry.model)
    .slice(0, 8);
  await setSetting(KEY, next);
  return next;
}
