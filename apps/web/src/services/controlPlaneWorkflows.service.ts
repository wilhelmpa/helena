import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelWorkflow,
  changeWorkflowSchedule,
  createWorkflowSchedule,
  decideWorkflow,
  getWorkflowRun,
  listProjectWorkflows,
  listWorkflowRuns,
  listWorkflowSchedules,
  retryWorkflow,
  startWorkflow,
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

export const useWorkflowRuns = (projectKey: string, workflowId: string | null) =>
  useQuery({
    queryKey: qk.controlPlaneWorkflowRuns(projectKey, workflowId ?? ''),
    queryFn: () => listWorkflowRuns(projectKey, workflowId!),
    enabled: workflowId != null,
  });

export const useWorkflowRun = (projectKey: string, workflowId: string, runId: string | null) =>
  useQuery({
    queryKey: qk.controlPlaneWorkflowRun(projectKey, workflowId, runId ?? ''),
    queryFn: () => getWorkflowRun(projectKey, workflowId, runId!),
    enabled: runId != null,
  });

export function useWorkflowControl(projectKey: string, workflowId: string) {
  const client = useQueryClient();
  const refresh = () =>
    client.invalidateQueries({ queryKey: qk.controlPlaneWorkflowRuns(projectKey, workflowId) });
  return {
    start: useMutation({
      mutationFn: () => startWorkflow(projectKey, workflowId),
      onSuccess: refresh,
    }),
    decide: useMutation({
      mutationFn: ({ runId, approved }: { runId: string; approved: boolean }) =>
        decideWorkflow(projectKey, workflowId, runId, approved),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: (runId: string) => cancelWorkflow(projectKey, workflowId, runId),
      onSuccess: refresh,
    }),
    retry: useMutation({
      mutationFn: (runId: string) => retryWorkflow(projectKey, workflowId, runId),
      onSuccess: refresh,
    }),
  };
}

export const useWorkflowSchedules = (projectKey: string, workflowId: string | null) =>
  useQuery({
    queryKey: qk.controlPlaneWorkflowSchedules(projectKey, workflowId ?? ''),
    queryFn: () => listWorkflowSchedules(projectKey, workflowId!),
    enabled: workflowId != null,
  });

export function useWorkflowScheduleControl(projectKey: string, workflowId: string) {
  const client = useQueryClient();
  const refresh = () =>
    client.invalidateQueries({
      queryKey: qk.controlPlaneWorkflowSchedules(projectKey, workflowId),
    });
  return {
    create: useMutation({
      mutationFn: (input: { cron: string; timezone: string }) =>
        createWorkflowSchedule(projectKey, workflowId, input),
      onSuccess: refresh,
    }),
    change: useMutation({
      mutationFn: ({
        scheduleId,
        action,
      }: {
        scheduleId: string;
        action: 'pause' | 'resume' | 'run' | 'delete';
      }) => changeWorkflowSchedule(projectKey, workflowId, scheduleId, action),
      onSuccess: refresh,
    }),
  };
}
