'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyModelMatrix,
  createModelSchema,
  deleteModelSchema,
  deleteModelSchemaRole,
  getModelSchemaAudit,
  getModelMatrix,
  getModelSchemas,
  previewModelMatrix,
  updateModelSchema,
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

// What a schema's role may use: the models per runtime and the thinking levels each offers,
// the same list the server checks a change against.
export function useSchemaCatalog(enabled = true) {
  return useQuery({
    queryKey: ['modelMatrix', 'schema-catalog'],
    queryFn: getModelSchemas,
    enabled,
    staleTime: 60_000,
  });
}

// Creating, renaming and deleting a schema change no agent and are written at once. The
// dialog shows a refusal itself (an id taken, a schema in use), so no toast.
export function useCreateSchema() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createModelSchema>[0]) => createModelSchema(input),
    meta: { suppressErrorToast: true },
    onSuccess: () => client.invalidateQueries({ queryKey: ['modelMatrix'] }),
  });
}

export function useUpdateSchema() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & Parameters<typeof updateModelSchema>[1]) => {
      const { id, ...body } = input;
      return updateModelSchema(id, body);
    },
    meta: { suppressErrorToast: true },
    onSuccess: () => client.invalidateQueries({ queryKey: ['modelMatrix'] }),
  });
}

export function useDeleteSchema() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; expectedRevision: number }) =>
      deleteModelSchema(input.id, input.expectedRevision),
    meta: { suppressErrorToast: true },
    onSuccess: () => client.invalidateQueries({ queryKey: ['modelMatrix'] }),
  });
}

export function useDeleteSchemaRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; role: string; expectedRevision: number }) =>
      deleteModelSchemaRole(input.id, input.role, input.expectedRevision),
    meta: { suppressErrorToast: true },
    onSuccess: () => client.invalidateQueries({ queryKey: ['modelMatrix'] }),
  });
}

export function useSchemaAudit() {
  return useQuery({
    queryKey: ['modelMatrix', 'audit'],
    queryFn: getModelSchemaAudit,
  });
}
