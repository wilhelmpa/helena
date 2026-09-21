import { request } from '@/lib/api/core/client';

export type HubInboxChannel = 'mail' | 'whatsapp';
export type HubInboxStatus = 'new' | 'assigned' | 'waiting' | 'done';
export type HubInboxPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface HubInboxSource {
  id: number;
  teamId: number;
  channel: HubInboxChannel;
  account: string;
  enabled: boolean;
  status: 'disabled' | 'connecting' | 'connected' | 'error';
  confidenceThreshold: number;
  autoCreateTasks: boolean;
  autoTaskProjectId: number | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface HubInboxThread {
  id: string;
  teamId: number;
  sourceId: number;
  channel: HubInboxChannel;
  account: string;
  externalThreadId: string;
  sender: string;
  subject: string;
  snippet: string;
  externalUrl: string | null;
  receivedAt: string;
  messageCount: number;
  projectId: number | null;
  projectKey: string | null;
  projectName: string | null;
  issueId: number | null;
  issueSequenceNumber: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  status: HubInboxStatus;
  priority: HubInboxPriority | null;
  triageSummary: string | null;
  triageStatus:
    'pending' | 'queued' | 'running' | 'succeeded' | 'needs_review' | 'failed' | 'skipped';
  lastTriageError: string | null;
  confidence: number | null;
  confidenceThreshold: number;
  requiresAction: boolean | null;
  ticketStatus: 'none' | 'pending' | 'running' | 'created' | 'failed' | 'skipped';
}

export interface HubInboxFilters {
  projectId?: number;
  channel?: HubInboxChannel;
  status?: HubInboxStatus;
  priority?: HubInboxPriority;
  needsReview?: boolean;
}

export interface HubInboxPage {
  items: HubInboxThread[];
  nextCursor: { ts: string; id: string } | null;
}

export const listHubInboxSources = (teamId: number) =>
  request<HubInboxSource[]>(`/hub-inbox/sources?teamId=${teamId}`);

export const updateHubInboxSource = (
  sourceId: number,
  patch: Partial<
    Pick<
      HubInboxSource,
      'enabled' | 'confidenceThreshold' | 'autoCreateTasks' | 'autoTaskProjectId'
    >
  >,
) =>
  request<HubInboxSource>(`/hub-inbox/sources/${sourceId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const listHubInboxThreads = (
  teamId: number,
  filters: HubInboxFilters,
  cursor: HubInboxPage['nextCursor'],
) => {
  const query = new URLSearchParams({ teamId: String(teamId), limit: '30' });
  if (filters.projectId != null) query.set('projectId', String(filters.projectId));
  if (filters.channel) query.set('channel', filters.channel);
  if (filters.status) query.set('status', filters.status);
  if (filters.priority) query.set('priority', filters.priority);
  if (filters.needsReview) query.set('needsReview', 'true');
  if (cursor) query.set('cursor', JSON.stringify(cursor));
  return request<HubInboxPage>(`/hub-inbox/threads?${query}`);
};

export const updateHubInboxThread = (
  threadId: string,
  patch: { status?: HubInboxStatus; projectId?: number | null; issueId?: number | null },
) =>
  request<void>(`/hub-inbox/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const retryHubInboxTriage = (threadId: string) =>
  request<void>(`/hub-inbox/threads/${threadId}/retry-triage`, { method: 'POST' });

export const createHubInboxTask = (threadId: string) =>
  request<{ issueId: number; sequenceNumber: number }>(
    `/hub-inbox/threads/${threadId}/create-task`,
    { method: 'POST' },
  );
