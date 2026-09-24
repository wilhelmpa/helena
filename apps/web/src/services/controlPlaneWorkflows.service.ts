import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageParams } from '@/lib/api/core/paging';
import {
  listProjectWorkflows,
  listWorkflowRuns,
  updateProjectWorkflow,
} from '@/lib/api/endpoints/controlPlaneWorkflows';
import { qk } from '@/services/queryKeys';

export const useProjectWorkflows = (projectKey: string) =>
  useQuery({
    queryKey: qk.controlPlaneWorkflows(projectKey),
    queryFn: () => listProjectWorkflows(projectKey),
  });

export function useUpdateProjectWorkflow(projectKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      workflowId,
      assignment,
    }: {
      workflowId: string;
      assignment: Parameters<typeof updateProjectWorkflow>[2];
    }) => updateProjectWorkflow(projectKey, workflowId, assignment),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.controlPlaneWorkflows(projectKey) }),
  });
}

// One page of the workflow's runs. Canceling or retrying one refreshes every list of
// engine runs (useCancelPipelineRun, useRetryPipelineRun).
export const useWorkflowRuns = (projectKey: string, workflowId: string, params: PageParams) =>
  useQuery({
    queryKey: qk.controlPlaneWorkflowRuns(projectKey, workflowId, params),
    queryFn: () => listWorkflowRuns(projectKey, workflowId, params),
  });
