import { getSetting, setSetting } from '@repo/db';

// The instance's defaults for every agent runtime, set in Administrator: the models a
// runtime falls back to when an agent's own model fails and the agent names none itself.

const KEY = 'agentRuntimeDefaults';

export interface FallbackModel {
  provider: string;
  model: string;
}

export interface AgentRuntimeDefaults {
  fallbackModels: FallbackModel[];
}

export async function getAgentRuntimeDefaults(): Promise<AgentRuntimeDefaults> {
  const stored = await getSetting<Partial<AgentRuntimeDefaults>>(KEY);
  return { fallbackModels: Array.isArray(stored?.fallbackModels) ? stored.fallbackModels : [] };
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
