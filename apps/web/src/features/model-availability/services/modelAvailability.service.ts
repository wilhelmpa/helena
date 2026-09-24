// What Helena learned about the models, as React Query hooks: the Administrator's list, and
// the two actions — try a model again, move every agent off one.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clearModelAvailability,
  clearModelAvailabilityAsAdmin,
  listModelAvailability,
  listTeamModelAvailability,
  replaceModel,
} from '@/lib/api/endpoints/modelAvailability';
import { qk } from '@/services/queryKeys';

export const modelAvailabilityKey = ['modelAvailability'] as const;

// A team's findings, for the agent editor (a copy whose runner has not published a catalog).
export function useTeamModelAvailability(teamId: number | null) {
  return useQuery({
    queryKey: [...modelAvailabilityKey, 'team', teamId ?? 0],
    queryFn: () => listTeamModelAvailability(teamId!),
    enabled: teamId != null,
    staleTime: 30_000,
    retry: false,
  });
}

export function useModelAvailability(enabled = true) {
  return useQuery({
    queryKey: modelAvailabilityKey,
    queryFn: listModelAvailability,
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

// Whatever reads a catalog, an agent or the health overview shows the change.
function useRefreshAll() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: modelAvailabilityKey }),
      qc.invalidateQueries({ queryKey: ['agent-chat-catalog'] }),
      qc.invalidateQueries({ queryKey: ['chatWorkspace', 'catalog'] }),
      qc.invalidateQueries({ queryKey: qk.systemHealth }),
    ]);
}

// A team's editor forgets through the team; the Administrator for the whole instance.
export function useClearModelAvailability() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ teamId, entryId }: { teamId: number | null; entryId: number }) =>
      teamId == null
        ? clearModelAvailabilityAsAdmin(entryId)
        : clearModelAvailability(teamId, entryId),
    onSuccess: () => refresh(),
  });
}

export function useReplaceModel() {
  const qc = useQueryClient();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ teamId, from, to }: { teamId: number; from: string; to: string | null }) =>
      replaceModel(teamId, { from, to }),
    onSuccess: async () => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ['aiAgents'] });
    },
  });
}
