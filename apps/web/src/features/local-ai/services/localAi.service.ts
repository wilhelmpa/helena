// Helena's local AI as React Query hooks: the status the card polls, the settings page, and
// the owner's changes (policy, servers, evals). Owner only (Administrator).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  checkModelServer,
  createModelServer,
  deleteModelServer,
  getEscalation,
  getLocalAiJudge,
  getLocalAiSettings,
  getLocalAiStatus,
  runLocalAiEval,
  updateEscalation,
  updateLocalAiJudge,
  updateLocalAiPolicy,
  updateModelOptions,
  updateModelServer,
  type EscalationPatch,
  type JudgePatch,
  type LocalAiSettings,
  type LocalModelStartOptions,
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

// A model's start options; Lemonade reads them the next time it starts the model.
export function useUpdateModelOptions() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      serverId,
      model,
      options,
    }: {
      serverId: number;
      model: string;
      options: LocalModelStartOptions;
    }) => updateModelOptions(serverId, model, options),
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

export const localAiJudgeKey = ['localAi', 'judge'] as const;
export const escalationKey = ['localAi', 'escalation'] as const;

export function useLocalAiJudge() {
  return useQuery({ queryKey: localAiJudgeKey, queryFn: getLocalAiJudge, retry: false });
}

export function useUpdateLocalAiJudge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: JudgePatch) => updateLocalAiJudge(patch),
    onSuccess: (judge) => qc.setQueryData(localAiJudgeKey, judge),
  });
}

export function useEscalation() {
  return useQuery({ queryKey: escalationKey, queryFn: getEscalation, retry: false });
}

export function useUpdateEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: EscalationPatch) => updateEscalation(patch),
    onSuccess: (settings) => qc.setQueryData(escalationKey, settings),
  });
}
