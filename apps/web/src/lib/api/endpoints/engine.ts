import { request } from '@/lib/api/core/client';

// The Helena engine (apps/api/src/modules/engine): its settings, the webhook of a
// workflow with a webhook trigger, and the key the webhook steps of a project sign with.

export interface EngineSettings {
  // The time zone a routine, a workflow schedule or a wait step uses when it names none.
  defaultTimezone: string;
}

export interface PipelineHook {
  id: string;
  // The path of the hook on the api; the sender posts to the api origin plus this.
  url: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const getEngineSettings = () => request<EngineSettings>('/workflow-engine/settings');

export const getPipelineHook = async (projectKey: string, pipelineId: number) =>
  (
    await request<{ hook: PipelineHook | null }>(
      `/projects/${projectKey}/pipelines/${pipelineId}/hook`,
    )
  ).hook;

// Creates the hook or gives it a new secret; the secret is answered only now.
export const createPipelineHook = (projectKey: string, pipelineId: number) =>
  request<{ id: string; url: string; secret: string }>(
    `/projects/${projectKey}/pipelines/${pipelineId}/hook`,
    { method: 'POST' },
  );

export const deletePipelineHook = (projectKey: string, pipelineId: number) =>
  request<void>(`/projects/${projectKey}/pipelines/${pipelineId}/hook`, { method: 'DELETE' });

export const getSigningSecret = (projectKey: string) =>
  request<{ secret: string }>(`/projects/${projectKey}/workflow-signing-secret`);

export const rotateSigningSecret = (projectKey: string) =>
  request<{ secret: string }>(`/projects/${projectKey}/workflow-signing-secret`, {
    method: 'POST',
  });
