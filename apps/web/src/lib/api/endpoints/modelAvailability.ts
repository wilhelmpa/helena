import { request } from '@/lib/api/core/client';

// What Helena learned about the models the providers serve this account
// (docs/helena-decisions/model-availability.md): a model a provider refused, which the
// pickers leave out, and one a run or chat answer confirmed.

// Why a run failed, where the runtime's words said.
export interface RunFailureRef {
  // 'model-unavailable': the provider does not serve the model to this account;
  // 'provider-rejected': it refused the request for good.
  code: string;
  model?: string | null;
}

export interface RunFailure extends RunFailureRef {
  retryable: boolean;
  detail?: string;
}

export interface ModelAvailabilityAgent {
  id: number;
  teamId: number;
  username: string;
  name: string;
  template: boolean;
}

export interface ModelAvailabilityEntry {
  id: number;
  runtime: string;
  provider: string;
  model: string;
  state: 'unavailable' | 'works';
  reason: string | null;
  detail: string | null;
  agentId: number | null;
  runId: number | null;
  chatMessageId: number | null;
  since: string;
  observedAt: string;
  agents: ModelAvailabilityAgent[];
}

export interface ReplaceModelResult {
  changed: { id: number; username: string; template: boolean; reasoning: string | null }[];
  followTemplate: { id: number; username: string }[];
  dryRun: boolean;
}

export const listTeamModelAvailability = (teamId: number) =>
  request<{ entries: ModelAvailabilityEntry[] }>(`/teams/${teamId}/model-availability`);

export const listModelAvailability = () =>
  request<{ entries: ModelAvailabilityEntry[] }>('/god/model-availability');

// "Erneut prüfen": the next use of the model tries it again.
export const clearModelAvailability = (teamId: number, entryId: number) =>
  request<void>(`/teams/${teamId}/model-availability/${entryId}`, { method: 'DELETE' });

export const clearModelAvailabilityAsAdmin = (entryId: number) =>
  request<void>(`/god/model-availability/${entryId}`, { method: 'DELETE' });

export const replaceModel = (
  teamId: number,
  body: { from: string; to: string | null; dryRun?: boolean },
) =>
  request<ReplaceModelResult>(`/teams/${teamId}/model-availability/replace`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
