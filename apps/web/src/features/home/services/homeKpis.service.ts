import { useQuery } from '@tanstack/react-query';
import { listAgentActivity } from '@/lib/api/endpoints/agentActivity';
import { qk } from '@/services/queryKeys';

// An agent is "running" for Start's "Agenten arbeiten" and "Läuft gerade" if its most recent
// activity entry is actively running or streaming a chat answer. This is a read
// of the recent timeline, newest first, not a dedicated live-count endpoint: a
// long run with a lot of other activity since it started could scroll past the
// window this checks. Good enough for "roughly how many, right now" without a new
// aggregation; see the design branch's report.
export const HOME_ACTIVE_STATUSES = new Set(['running', 'streaming']);

const RECENT_WINDOW = 40;

export function useHomeActiveActivity() {
  return useQuery({
    queryKey: qk.agentActivity(null, { window: RECENT_WINDOW }),
    queryFn: () => listAgentActivity(null, {}, null),
    // Refetched often enough to read as "live" without hammering the API — the
    // same tradeoff the activity page itself makes.
    refetchInterval: 15_000,
  });
}
