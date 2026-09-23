import { useInfiniteQuery } from '@tanstack/react-query';
import {
  listAgentActivity,
  type AgentActivityCursor,
  type AgentActivityFilters,
} from '@/lib/api/endpoints/agentActivity';
import { qk } from '@/services/queryKeys';

// The agent timeline of a project, or of Home when projectKey is null, a page at a time.
export function useAgentActivityFeed(projectKey: string | null, filters: AgentActivityFilters) {
  return useInfiniteQuery({
    queryKey: qk.agentActivity(projectKey, filters),
    queryFn: ({ pageParam }) => listAgentActivity(projectKey, filters, pageParam),
    initialPageParam: null as AgentActivityCursor | null,
    getNextPageParam: (page) => page.nextCursor,
  });
}
