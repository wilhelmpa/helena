import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyProjectTemplate,
  captureProjectTemplate,
  deleteProjectTemplate,
  listProjectTemplates,
} from '@/lib/api/endpoints/projectTemplates';
import { qk } from '@/services/queryKeys';

export function useProjectTemplates(projectKey: string) {
  return useQuery({
    queryKey: qk.projectTemplates(projectKey),
    queryFn: () => listProjectTemplates(projectKey),
  });
}

export function useCaptureProjectTemplate(projectKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof captureProjectTemplate>[1]) =>
      captureProjectTemplate(projectKey, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.projectTemplates(projectKey) }),
  });
}

export function useApplyProjectTemplate(projectKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: number) => applyProjectTemplate(projectKey, templateId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.projectTemplates(projectKey) }),
        queryClient.invalidateQueries({ queryKey: qk.project(projectKey) }),
        queryClient.invalidateQueries({ queryKey: qk.views(projectKey) }),
        queryClient.invalidateQueries({ queryKey: qk.actions(projectKey) }),
        queryClient.invalidateQueries({ queryKey: qk.projectProvisioning(projectKey) }),
      ]);
    },
  });
}

export function useDeleteProjectTemplate(projectKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: number) => deleteProjectTemplate(projectKey, templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.projectTemplates(projectKey) }),
  });
}
