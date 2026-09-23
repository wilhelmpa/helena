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

export function waitingCount(actions: RuntimeAction[] | undefined): number {
  return (actions ?? []).filter((action) => action.error === null).length;
}
