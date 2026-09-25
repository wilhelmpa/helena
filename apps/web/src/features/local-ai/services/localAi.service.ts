// Helena's local AI as React Query hooks: the status the card polls, the settings page, and
// the owner's changes (policy, servers, evals). Owner only (Administrator).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  checkModelServer,
  createModelServer,
  deleteModelServer,
  getLocalAiSettings,
  getLocalAiStatus,
  runLocalAiEval,
  updateLocalAiPolicy,
  updateModelServer,
  type LocalAiSettings,
  type PolicyPatch,
  type ServerInput,
} from '@/lib/api/endpoints/localAi';

export const localAiKey = ['localAi'] as const;
export const localAiStatusKey = ['localAi', 'status'] as const;
export const localAiSettingsKey = ['localAi', 'settings'] as const;

export function useLocalAiStatus(enabled = true) {
  return useQuery({
    queryKey: localAiStatusKey,
    queryFn: getLocalAiStatus,
    enabled,
    // The load moves by the second; the card shows a live picture without flooding the API.
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });
}

export function useLocalAiSettings(enabled = true) {
  return useQuery({
    queryKey: localAiSettingsKey,
    queryFn: getLocalAiSettings,
    enabled,
    // While an eval runs in the background (minutes on a local model), the page follows it.
    refetchInterval: (query) => (query.state.data?.runningEvals.length ? 3_000 : 60_000),
    staleTime: 30_000,
    retry: false,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: localAiKey });
}

export function useUpdateLocalAiPolicy() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (patch: PolicyPatch) => updateLocalAiPolicy(patch),
    onSuccess: (policy) => {
      qc.setQueryData<LocalAiSettings>(localAiSettingsKey, (current) =>
        current ? { ...current, policy } : current,
      );
      void invalidate();
    },
  });
}

export function useCreateModelServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ServerInput) => createModelServer(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateModelServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: ServerInput }) => updateModelServer(id, input),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteModelServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => deleteModelServer(id),
    onSuccess: () => invalidate(),
  });
}

export function useCheckModelServer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => checkModelServer(id),
    onSuccess: () => invalidate(),
  });
}

export function useRunLocalAiEval() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ classId, modelId }: { classId: string; modelId: string }) =>
      runLocalAiEval(classId, modelId),
    onSuccess: () => invalidate(),
  });
}
