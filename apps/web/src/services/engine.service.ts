import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPipelineHook,
  deletePipelineHook,
  getEngineSettings,
  getEngineTypes,
  getPipelineHook,
  getSigningSecret,
  rotateSigningSecret,
} from '@/lib/api/endpoints/engine';
import { qk } from '@/services/queryKeys';

// The instance's default time zone rarely changes, so it is kept for a while.
export const useEngineSettings = () =>
  useQuery({ queryKey: qk.engineSettings, queryFn: getEngineSettings, staleTime: 300_000 });

// The step and trigger types the engine runs, the plugins' among them. They change when a
// plugin is switched on or off, which restarts the api.
export const useEngineTypes = () =>
  useQuery({ queryKey: qk.engineTypes, queryFn: getEngineTypes, staleTime: 300_000 });

export const usePipelineHook = (projectKey: string, pipelineId: number, enabled = true) =>
  useQuery({
    queryKey: qk.pipelineHook(projectKey, pipelineId),
    queryFn: () => getPipelineHook(projectKey, pipelineId),
    enabled,
  });

export function usePipelineHookControl(projectKey: string, pipelineId: number) {
  const client = useQueryClient();
  const refresh = () =>
    client.invalidateQueries({ queryKey: qk.pipelineHook(projectKey, pipelineId) });
  return {
    create: useMutation({
      mutationFn: () => createPipelineHook(projectKey, pipelineId),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: () => deletePipelineHook(projectKey, pipelineId),
      onSuccess: refresh,
    }),
  };
}

// The signing key is read only when a person asks to see it.
export const useSigningSecret = (projectKey: string, enabled: boolean) =>
  useQuery({
    queryKey: qk.signingSecret(projectKey),
    queryFn: () => getSigningSecret(projectKey),
    enabled,
    staleTime: Infinity,
  });

export function useRotateSigningSecret(projectKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => rotateSigningSecret(projectKey),
    onSuccess: (data) => client.setQueryData(qk.signingSecret(projectKey), data),
  });
}
