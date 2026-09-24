import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';
import type { PipelineRun } from '@/lib/api/endpoints/pipelines';

// The built-in workflows of a project (the agent team), which the Helena engine runs.
// Their runs are engine runs like a builder workflow's: canceled and retried through
// /pipeline-runs (lib/api/endpoints/pipelines.ts).

export interface WorkflowStep {
  id: string;
  title: string;
  description: string;
}

export interface ProjectWorkflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  triggers: string[];
  capabilityRefs: string[];
  externalEffects: boolean;
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

export const listWorkflowRuns = (projectKey: string, workflowId: string, params: PageParams) =>
  request<Page<PipelineRun>>(
    `/projects/${projectKey}/control-plane/workflows/${workflowId}/runs${pageQuery(params)}`,
  );
