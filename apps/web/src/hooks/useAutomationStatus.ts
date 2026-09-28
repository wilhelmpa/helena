import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAgentActivity } from '@/lib/api/endpoints/agentActivity';
import { qk } from '@/services/queryKeys';
import { openWorkByAgent } from '@/utils/agentWorkState';
import type { StatusDotTone } from '@/design-system';

// The status dot of "Automatisierung" / "Team" in the sidebar (docs/design-system.md §6):
// amber when an agent of the project waits for you, orange while one works, nothing at
// rest. Home looks at every project. Reads the same recent timeline as the agent status
// orbs (useAgentWorkStates), so it adds no request.
export function useAutomationStatus(projectKey: string | null): StatusDotTone | null {
  const activity = useQuery({
    queryKey: qk.agentActivity(null, { window: 40 }),
    queryFn: () => listAgentActivity(null, {}, null),
    refetchInterval: 15_000,
  });
  return useMemo(() => {
    const items = (activity.data?.items ?? []).filter(
      (item) => projectKey == null || item.project?.key === projectKey,
    );
    const work = [...openWorkByAgent(items).values()];
    if (work.includes('waiting')) return 'waiting';
    if (work.includes('running')) return 'working';
    return null;
  }, [activity.data, projectKey]);
}
