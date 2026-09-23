import { useQuery } from '@tanstack/react-query';
import { listAgentActivity } from '@/lib/api/endpoints/agentActivity';
import { qk } from '@/services/queryKeys';

// An agent is "running" for the KPI row and "Agenten gerade" if its most recent
// activity entry is still open — queued, actively running, streaming a chat
// answer, or paused waiting on something (an approval, an answer). This is a read
// of the recent timeline, newest first, not a dedicated live-count endpoint: a
// long run with a lot of other activity since it started could scroll past the
// window this checks. Good enough for "roughly how many, right now" without a new
// aggregation; see the design branch's report.
export const HOME_ACTIVE_STATUSES = new Set([
  'pending',
  'running',
  'streaming',
  'waiting',
  'suspended',
]);

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

export function useHomeRunningAgentsCount(): { count: number; isPending: boolean } {
  const query = useHomeActiveActivity();
  const items = query.data?.items ?? [];
  // One entry per agent+kind can appear more than once in a raw activity window
  // (e.g. an agent-team run and its own chat answer); count distinct agents, not
  // rows, so "3 running" means three agents, not three log lines.
  const agentIds = new Set(
    items
      .filter((entry) => HOME_ACTIVE_STATUSES.has(entry.status) && entry.agent)
      .map((entry) => entry.agent!.id),
  );
  return { count: agentIds.size, isPending: query.isPending };
}
