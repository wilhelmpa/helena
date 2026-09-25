import { getSetting, setSetting } from '@repo/db';

// The instance's defaults for every agent runtime, set in Administrator: the models a
// runtime falls back to when an agent's own model fails and the agent names none itself, how
// long Hermes keeps the sessions of ended runs and chats (their transcripts), which of the
// skills that ship with Hermes every profile carries, and from how many tokens Hermes
// compresses a conversation (docs/helena-decisions/agent-context.md §3, §6).

const KEY = 'agentRuntimeDefaults';

export interface FallbackModel {
  provider: string;
  model: string;
}

// 'all': every profile carries the skills that ship with Hermes (Hermes' own seeding,
// run the same way for every profile); 'essential': only the one Hermes needs itself.
export type BundledSkills = 'all' | 'essential';

// A long conversation is compressed from here on unless the agent sets its own: well below
// the windows of today's models (272k on the Codex route, whose trigger Hermes raises to
// 85 %), so a long chat no longer resends 100k–250k tokens with every call.
export const DEFAULT_COMPRESSION_THRESHOLD = 100_000;

export interface AgentRuntimeDefaults {
  fallbackModels: FallbackModel[];
  // Null keeps Hermes' own default (90 days).
  sessionRetentionDays: number | null;
  bundledSkills: BundledSkills;
  compressionThresholdTokens: number;
}

export async function getAgentRuntimeDefaults(): Promise<AgentRuntimeDefaults> {
  const stored = await getSetting<Partial<AgentRuntimeDefaults>>(KEY);
  return {
    fallbackModels: Array.isArray(stored?.fallbackModels) ? stored.fallbackModels : [],
    sessionRetentionDays:
      typeof stored?.sessionRetentionDays === 'number' ? stored.sessionRetentionDays : null,
    bundledSkills: stored?.bundledSkills === 'essential' ? 'essential' : 'all',
    compressionThresholdTokens:
      typeof stored?.compressionThresholdTokens === 'number'
        ? stored.compressionThresholdTokens
        : DEFAULT_COMPRESSION_THRESHOLD,
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
