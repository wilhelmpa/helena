'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyGlobalModel,
  bulkLocalDefault,
  getModelPicker,
  previewGlobalModel,
  resumeGlobalModel,
} from '@/lib/api/endpoints/globalModel';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { isLocalModel } from '../utils/modelIdentity';
import { useUpdateAiAgent } from '@/services/aiAgents.service';
import { useLocalAiStatus } from './localAi.service';

export function useGlobalLocalModel(enabled = true) {
  const status = useLocalAiStatus(enabled);
  return { ...status, data: status.data?.globalModel };
}
export function useModelPicker(scope: string, agentId: number | null) {
  return useQuery({
    queryKey: ['modelPicker', scope, agentId],
    queryFn: () => getModelPicker(scope, agentId!),
    enabled: agentId !== null,
  });
}
export function useGlobalModelActions() {
  const client = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['localAi'] }),
      client.invalidateQueries({ queryKey: ['modelPicker'] }),
    ]);
  };
  return {
    preview: useMutation({ mutationFn: previewGlobalModel }),
    apply: useMutation({ mutationFn: applyGlobalModel, onSuccess: refresh }),
    resume: useMutation({ mutationFn: resumeGlobalModel, onSuccess: refresh }),
    bulk: useMutation({
      mutationFn: ({ ids, apply }: { ids: number[]; apply: boolean }) =>
        bulkLocalDefault(ids, apply),
      onSuccess: refresh,
    }),
  };
}
// Retains the saved value while PATCH is pending or fails; the shared mutation provides feedback.
export function useImmediateAgentModel(teamId: number, savedAgent: AiAgent) {
  const mutation = useUpdateAiAgent(teamId);
  const client = useQueryClient();
  return {
    ...mutation,
    save: async (model: string | null, thinkingLevel: string | null) => {
      const agent = await mutation.mutateAsync({
        id: savedAgent.id,
        patch: {
          model,
          runtimePolicy: {
            ...savedAgent.runtimePolicy,
            reasoningEffort: thinkingLevel,
            ...(isLocalModel(model) ? { runtime: 'hermes' as const } : {}),
          },
        },
      });
      await client.invalidateQueries({ queryKey: ['modelPicker'] });
      return agent;
    },
  };
}
