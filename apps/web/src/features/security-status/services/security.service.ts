'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/services/queryKeys';
import {
  getEdgeAccess,
  getSecurityStatus,
  updateEdgeAccess,
  type EdgeAccessPatch,
} from '@/lib/api/endpoints/security';

// The audit runs hourly on the host; a minute is plenty for a page left open.
const STATUS_POLL_MS = 60_000;

// `enabled` false for a reader who is not the owner (Start asks for everyone).
export function useSecurityStatusQuery(enabled = true) {
  return useQuery({
    queryKey: qk.securityStatus,
    queryFn: () => getSecurityStatus(),
    refetchInterval: STATUS_POLL_MS,
    enabled,
  });
}

export function useEdgeAccessQuery() {
  return useQuery({ queryKey: qk.edgeAccess, queryFn: () => getEdgeAccess() });
}

export function useUpdateEdgeAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: EdgeAccessPatch) => updateEdgeAccess(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.edgeAccess, data);
      void queryClient.invalidateQueries({ queryKey: qk.securityStatus });
    },
  });
}
