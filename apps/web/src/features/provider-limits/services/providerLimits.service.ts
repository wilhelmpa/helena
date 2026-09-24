// The plan limits (ChatGPT/Codex, Claude) as React Query hooks: read every minute while a
// page shows them, refreshed on demand, and the Administrator's settings.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  forgetLimitAccount,
  getProviderLimits,
  refreshProviderLimits,
  setLimitSettings,
  type LimitSettings,
  type ProviderLimits,
} from '@/lib/api/endpoints/providerLimits';

export const providerLimitsKey = ['providerLimits'] as const;

export function useProviderLimits(enabled = true) {
  return useQuery({
    queryKey: providerLimitsKey,
    queryFn: getProviderLimits,
    enabled,
    // The numbers move with every answer an agent gets; the countdowns tick on their own.
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

export function useRefreshProviderLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshProviderLimits,
    onSuccess: (value) => qc.setQueryData(providerLimitsKey, value),
  });
}

export function useSetLimitSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<LimitSettings>) => setLimitSettings(patch),
    onSuccess: (settings) =>
      qc.setQueryData<ProviderLimits>(providerLimitsKey, (current) =>
        current ? { ...current, settings } : current,
      ),
  });
}

export function useForgetLimitAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: forgetLimitAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: providerLimitsKey }),
  });
}
