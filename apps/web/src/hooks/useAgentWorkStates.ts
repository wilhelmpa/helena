'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAgentActivity } from '@/lib/api/endpoints/agentActivity';
import { qk } from '@/services/queryKeys';
import { openWorkByAgent } from '@/utils/agentWorkState';

export function useAgentWorkStates(): Map<number, 'running' | 'waiting'> {
  const activity = useQuery({
    queryKey: qk.agentActivity(null, { window: 40 }),
    queryFn: () => listAgentActivity(null, {}, null),
    refetchInterval: 15_000,
  });
  return useMemo(() => openWorkByAgent(activity.data?.items ?? []), [activity.data]);
}
