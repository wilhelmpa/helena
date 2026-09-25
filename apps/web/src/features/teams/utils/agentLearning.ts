import type { AgentRuntimePolicy, AgentRuntimeState } from '@/lib/api/endpoints/agents';
import type { RuntimeAction } from '@/lib/api/endpoints/agentLearning';

// The agent's learning switches with their defaults: an agent learns unless it is told
// not to, the curator stays off until it is turned on, and it reflects on a failed run,
// rework, or a run of many steps unless reflection is turned off or down to failures only.
export function learningOf(policy: AgentRuntimePolicy): {
  learning: boolean;
  curator: boolean;
  reflection: NonNullable<AgentRuntimePolicy['reflection']>;
} {
  return {
    learning: policy.learning ?? true,
    curator: policy.curator ?? false,
    reflection: policy.reflection ?? 'complex',
  };
}

// Reflection on chats with its defaults (docs/helena-decisions/agent-context.md §5): on for a
// learning agent, once a chat has been quiet for 10 minutes, at the latest after 20 of the
// person's messages. The bounds are the server's.
export const CHAT_REFLECTION_BOUNDS = {
  idleMinutes: { min: 2, max: 1440 },
  everyTurns: { min: 2, max: 200 },
} as const;

export function chatReflectionOf(policy: AgentRuntimePolicy): {
  enabled: boolean;
  idleMinutes: number;
  everyTurns: number;
} {
  return {
    enabled: (policy.learning ?? true) && (policy.chatReflection ?? true),
    idleMinutes: policy.chatReflectionIdleMinutes ?? 10,
    everyTurns: policy.chatReflectionEveryTurns ?? 20,
  };
}

// A number typed into a bounded field: the whole number within the bounds, or undefined
// (the default) for an empty or invalid entry.
export function boundedNumber(
  value: string,
  bounds: { min: number; max: number },
): number | undefined {
  if (value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= bounds.min && number <= bounds.max
    ? number
    : undefined;
}

// Whether the agent's runner carries out the owner's actions on what it learned. An older
// runner reports no skill paths and no memory versions to act on.
export function canActOnLearning(state: AgentRuntimeState): boolean {
  return state.capabilities.includes('learning');
}

// The newest action on a skill path or a memory file, waiting or failed. A done action is
// no longer listed, so there is none then.
export function actionOn(
  actions: RuntimeAction[] | undefined,
  target: string,
  kinds: RuntimeAction['kind'][],
): RuntimeAction | null {
  const matching = (actions ?? []).filter(
    (action) => action.target === target && kinds.includes(action.kind),
  );
  return matching.at(-1) ?? null;
}

export const SKILL_ACTIONS: RuntimeAction['kind'][] = ['discard-skill', 'pin-skill'];
export const MEMORY_ACTIONS: RuntimeAction['kind'][] = ['write-memory'];

// While one waits, the runner has not carried it out, so the list shows the new state.
export function pinnedAfter(pinned: boolean, action: RuntimeAction | null): boolean {
  return action?.kind === 'pin-skill' && action.error === null ? action.pinned === true : pinned;
}

// "Neu schreiben" waits in the same list, but is the profile sync's, not learning's.
export function waitingCount(actions: RuntimeAction[] | undefined): number {
  return (actions ?? []).filter(
    (action) => action.error === null && action.kind !== 'rewrite-profile',
  ).length;
}
