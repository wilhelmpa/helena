import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import type { NeedsYouEntry } from '@/extensions/needsYouSources';
import { isRoutineHeartbeat } from '@/features/agent-activity/utils/heartbeatBundles';

export const START_CARDS = 3;
const ACTIVE = new Set(['pending', 'running', 'streaming']);

export type StartCard =
  | { kind: 'needs'; entry: NeedsYouEntry }
  | { kind: 'running' | 'finished'; entry: AgentActivityEntry };

// The finished runs of the heartbeats filled the start page every 15 minutes (owner, D);
// they are left out here.
export { isRoutineHeartbeat };

// The cards under Helena's chat on the start page (owner, D: "Braucht dich" first): what
// waits for the owner — red problems, then decisions — then the work running now, then
// what finished last. Idle heartbeats are left out; failures are for "Braucht dich" on the
// dashboard, where they can be hidden.
export function startCards(
  needs: NeedsYouEntry[],
  activity: AgentActivityEntry[],
  limit = START_CARDS,
): StartCard[] {
  const waiting = needs.filter((entry) => entry.kind !== 'failure');
  const work = activity.filter((entry) => entry.project && !isRoutineHeartbeat(entry));
  return [
    ...waiting.map((entry) => ({ kind: 'needs' as const, entry })),
    ...work
      .filter((entry) => ACTIVE.has(entry.status))
      .map((entry) => ({ kind: 'running' as const, entry })),
    ...work
      .filter((entry) => entry.status === 'success')
      .map((entry) => ({ kind: 'finished' as const, entry })),
  ].slice(0, limit);
}
