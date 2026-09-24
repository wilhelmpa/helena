// Whether an agent's runtime profile matches its settings, and "Neu schreiben".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { getRuntimeSync, rewriteRuntimeProfile } from '@/lib/api/endpoints/agentRuntimeSync';
import { qk } from '@/services/queryKeys';

// A runner syncs every few seconds while it waits for work; a check of the profile follows
// right after the settings changed.
const WAITING_REFRESH_MS = 4_000;
const REFRESH_MS = 60_000;

export function useRuntimeSyncQuery(teamId: number, agentId: number | null) {
  return useQuery({
    queryKey: qk.agentRuntimeSync(teamId, agentId ?? 0),
    queryFn: () => getRuntimeSync(teamId, agentId!),
    enabled: agentId != null,
    refetchInterval: (current) => {
      const data = current.state.data;
      return data && (data.state === 'pending' || data.rewritePending)
        ? WAITING_REFRESH_MS
        : REFRESH_MS;
    },
  });
}

export function useRewriteRuntimeProfile(teamId: number, agentId: number) {
  const t = useTranslations('teams.agents.profileSync');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rewriteRuntimeProfile(teamId, agentId),
    onSuccess: (sync) => {
      toast.success(t('rewriteQueued'));
      qc.setQueryData(qk.agentRuntimeSync(teamId, agentId), sync);
    },
  });
}
