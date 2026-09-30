'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyModelMatrix,
  getModelMatrix,
  previewModelMatrix,
  type MatrixPatch,
} from '@/lib/api/endpoints/modelMatrix';
import { getAiAgentChatCatalog } from '@/lib/api/endpoints/agentChat';

const key = (teamId: number, projectId?: number) =>
  ['modelMatrix', teamId, projectId ?? 'all'] as const;

export function useModelMatrix(teamId: number, projectId?: number) {
  return useQuery({
    queryKey: key(teamId, projectId),
    queryFn: () => getModelMatrix(teamId, projectId),
    enabled: teamId > 0,
  });
}

// The models the agents' pickers offer, read through any agent of the team (the catalog is
// the same for all of them); names the model ids in the matrix.
export function useModelCatalog(teamId: number, agentId: number | undefined) {
  return useQuery({
    queryKey: ['modelMatrix', teamId, 'catalog', agentId],
    queryFn: () => getAiAgentChatCatalog(`team:${teamId}`, agentId!),
    enabled: teamId > 0 && agentId !== undefined,
    staleTime: 60_000,
  });
}

export function usePreviewMatrix() {
  // The dialog shows the error itself, so the global toast stays out of it.
  return useMutation({
    mutationFn: (patch: MatrixPatch) => previewModelMatrix(patch),
    meta: { suppressErrorToast: true },
  });
}

export function useApplyMatrix() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: MatrixPatch) => applyModelMatrix(patch),
    meta: { suppressErrorToast: true },
    onSuccess: () => client.invalidateQueries({ queryKey: ['modelMatrix'] }),
  });
}
