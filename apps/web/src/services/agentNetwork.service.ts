import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAgentNetworkSettings,
  listAgentNetworkEvents,
  updateAgentNetworkSettings,
  type AgentNetworkSettingsPatch,
} from '@/lib/api/endpoints/agentNetwork';
import { qk } from '@/services/queryKeys';

export function useAgentNetworkSettingsQuery(projectKey: string) {
  return useQuery({
    queryKey: qk.agentNetworkSettings(projectKey),
    queryFn: () => getAgentNetworkSettings(projectKey),
  });
}

// Writes the settings, then seeds the query cache with the normalized response
// directly, so a re-render before the invalidated fetch lands still shows what was
// actually stored (not the raw text the fields were typed as).
export function useUpdateAgentNetworkSettings(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AgentNetworkSettingsPatch) => updateAgentNetworkSettings(projectKey, patch),
    onSuccess: (data) => {
      qc.setQueryData(qk.agentNetworkSettings(projectKey), data);
    },
  });
}

// The project's connection log, 50 at a time, newest first. 'blocked' filters to
// the refused connections only.
export function useAgentNetworkEvents(projectKey: string, decision: 'all' | 'blocked') {
  return useInfiniteQuery({
    queryKey: qk.agentNetworkEvents(projectKey, decision),
    queryFn: ({ pageParam }) =>
      listAgentNetworkEvents(projectKey, {
        before: pageParam,
        decision: decision === 'blocked' ? 'blocked' : undefined,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}
