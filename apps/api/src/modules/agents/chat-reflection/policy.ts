import {
  CHAT_REFLECTION_LIMITS,
  type AgentRuntimeKind,
  type AgentRuntimePolicy,
} from '../core/service';

// When an agent reflects on a chat (docs/helena-decisions/agent-context.md §5). Pure, so the
// rules are tested without a database.

// A conversation needs this many of the person's messages since the last reflection before
// one is worth it: a single question rarely says how the person wants things done.
export const MIN_CHAT_REFLECTION_TURNS = 2;

export interface ChatReflectionSettings {
  enabled: boolean;
  idleMinutes: number;
  everyTurns: number;
}

// The agent's settings with their defaults. Only a learning Hermes agent reflects: the
// reflection works with Hermes' memory and skill tools, whose writes the owner approves.
export function chatReflectionSettings(
  policy: AgentRuntimePolicy,
  runtime: AgentRuntimeKind = policy.runtime ?? 'hermes',
): ChatReflectionSettings {
  return {
    enabled: runtime === 'hermes' && policy.learning !== false && policy.chatReflection !== false,
    idleMinutes: policy.chatReflectionIdleMinutes ?? CHAT_REFLECTION_LIMITS.idleMinutes.default,
    everyTurns: policy.chatReflectionEveryTurns ?? CHAT_REFLECTION_LIMITS.everyTurns.default,
  };
}

// When the reflection on a chat is due after an answer, or null when none is: the person
// wrote `turns` messages since the last reflection. After many turns it runs at once;
// otherwise once the chat has been quiet for the idle time, which every later answer moves
// on (a debounce), so a conversation is reflected on once, when it ends.
export function chatReflectionDue(
  settings: ChatReflectionSettings,
  turns: number,
  now: Date,
): { reason: 'idle' | 'turns'; at: Date } | null {
  if (!settings.enabled || turns < MIN_CHAT_REFLECTION_TURNS) return null;
  if (turns >= settings.everyTurns) return { reason: 'turns', at: now };
  return { reason: 'idle', at: new Date(now.getTime() + settings.idleMinutes * 60_000) };
}
