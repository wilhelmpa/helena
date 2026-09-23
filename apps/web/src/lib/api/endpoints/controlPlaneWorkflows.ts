import { request } from '@/lib/api/core/client';

export interface WorkflowStep {
  id?: string;
  title: string;
  description: string;
  sourceRefs?: string[];
}

export interface ProjectWorkflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  triggers: string[];
  capabilityRefs: string[];
  externalEffects: boolean;
  currentLimits?: string[];
  assignment: {
    enabled: boolean;
    capabilityRefs: string[];
    configuration: {
      instructions?: string;
      retryLimit?: number;
      // agent-team only; the API returns them with their defaults filled in.
      autonomy?: 'review' | 'done';
      reviewRequired?: boolean;
      maxTurns?: number | null;
      runBudgetSeconds?: number | null;
    };
    createdAt?: string;
    updatedAt?: string;
  };
}

export interface WorkflowRun {
  runId?: string;
  id?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  suspendedPaths?: Record<string, unknown>;
  steps?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export interface WorkflowSchedule {
  id: string;
  workflowId: string;
  cron?: string;
  timezone?: string;
  status?: string;
  enabled?: boolean;
  nextRunAt?: string;
}

export const listProjectWorkflows = (projectKey: string) =>
  request<ProjectWorkflow[]>(`/projects/${projectKey}/control-plane/workflows`);

export const updateProjectWorkflow = (
  projectKey: string,
  workflowId: string,
  input: ProjectWorkflow['assignment'],
) =>
  request(`/projects/${projectKey}/control-plane/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify({
      enabled: input.enabled,
      capabilityRefs: input.capabilityRefs,
      configuration: input.configuration,
    }),
  });

export const listWorkflowRuns = (projectKey: string, workflowId: string) =>
  request<{ runs?: WorkflowRun[] } | WorkflowRun[]>(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/runs`,
  );

export const getWorkflowRun = (projectKey: string, workflowId: string, runId: string) =>
  request<WorkflowRun>(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/runs/${runId}`,
  );

export const startWorkflow = (projectKey: string, workflowId: string) =>
  request<WorkflowRun>(`/projects/${projectKey}/control-plane/workflows/${workflowId}/runs`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), dryRun: true, payload: {} }),
  });

export const decideWorkflow = (
  projectKey: string,
  workflowId: string,
  runId: string,
  approved: boolean,
) =>
  request<WorkflowRun>(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/runs/${runId}/approval`,
    { method: 'POST', body: JSON.stringify({ approved }) },
  );

export const cancelWorkflow = (projectKey: string, workflowId: string, runId: string) =>
  request<WorkflowRun>(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/runs/${runId}/cancel`,
    { method: 'POST' },
  );

export const retryWorkflow = (projectKey: string, workflowId: string, runId: string) =>
  request<WorkflowRun>(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/runs/${runId}/retry`,
    { method: 'POST' },
  );

export const listWorkflowSchedules = (projectKey: string, workflowId: string) =>
  request<{ schedules: WorkflowSchedule[] }>(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/schedules`,
  );

export const createWorkflowSchedule = (
  projectKey: string,
  workflowId: string,
  input: { cron: string; timezone: string },
) =>
  request<WorkflowSchedule>(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/schedules`,
    { method: 'POST', body: JSON.stringify({ ...input, payload: {} }) },
  );

export const changeWorkflowSchedule = (
  projectKey: string,
  workflowId: string,
  scheduleId: string,
  action: 'pause' | 'resume' | 'run' | 'delete',
) =>
  request(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/schedules/${scheduleId}${
      action === 'delete' ? '' : `/${action}`
    }`,
    { method: action === 'delete' ? 'DELETE' : 'POST' },
  );
