'use client';

// The update center as React Query hooks: read every few seconds while a check, a summary
// or an update is going, every few minutes otherwise; "Jetzt prüfen", "Aktualisieren" and
// the settings.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyUpdate,
  checkForUpdates,
  getUpdateCenter,
  setUpdateSettings,
  type UpdateCenter,
  type UpdateScope,
  type UpdateSettings,
} from '@/lib/api/endpoints/updateCenter';
import { isBusy } from '../utils/updateFormat';

export const updateCenterKey = ['updateCenter'] as const;

export function useUpdateCenter(enabled = true) {
  return useQuery({
    queryKey: updateCenterKey,
    queryFn: getUpdateCenter,
    enabled,
    refetchInterval: (query) => (isBusy(query.state.data) ? 3_000 : 5 * 60_000),
    staleTime: 2_000,
    retry: false,
  });
}

export function useCheckForUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (value) => qc.setQueryData(updateCenterKey, value),
  });
}

export function useApplyUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, scope }: { itemId: number; scope: UpdateScope }) =>
      applyUpdate(itemId, scope),
    onSuccess: () => qc.invalidateQueries({ queryKey: updateCenterKey }),
  });
}

export function useSetUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UpdateSettings>) => setUpdateSettings(patch),
    onSuccess: (settings) => {
      qc.setQueryData<UpdateCenter>(updateCenterKey, (current) =>
        current ? { ...current, settings } : current,
      );
      // The automatic choice of agent and model depends on the settings.
      void qc.invalidateQueries({ queryKey: updateCenterKey });
    },
  });
}
