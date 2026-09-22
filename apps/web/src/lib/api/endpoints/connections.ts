import { API_URL, apiFailure, request } from '@/lib/api/core/client';

export type ConnectionStatus =
  'connected' | 'available' | 'configured' | 'disabled' | 'unavailable' | 'unsupported' | 'error';

export interface ConnectionItem {
  id: string;
  kind: 'mcp' | 'channel' | 'service' | 'mail';
  provider: string;
  label: string;
  accountId?: string;
  status: ConnectionStatus;
  configured: boolean;
  connected: boolean;
  running: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  canProbe: boolean;
  canReconnect: boolean;
  canPair: boolean;
  toolCount?: number;
  manageUrl?: string | null;
}

export interface ConnectionsSnapshot {
  checkedAt: string;
  items: ConnectionItem[];
}

export interface MailAccountStatus {
  account: string;
  status: ConnectionStatus;
  lastCheckedAt: string;
  lastError: string | null;
}

export type MailPayload = Record<string, unknown> | unknown[];

export const getConnections = () => request<ConnectionsSnapshot>('/connections');
export interface VaultStatus {
  checkedAt: string;
  accessUrl: string | null;
  accessStatus: 'protected' | 'reachable' | 'unavailable' | 'unconfigured';
  httpStatus: number | null;
  serviceHealthExposed: false;
  secretValuesExposed: false;
}

export const getVaultStatus = () => request<VaultStatus>('/vault/status', { cache: 'no-store' });
export const runConnectionAction = (id: string, action: 'probe' | 'reconnect') =>
  request<ConnectionsSnapshot>('/connections/actions', {
    method: 'POST',
    body: JSON.stringify({ id, action }),
  });
export const getMailAccounts = () => request<{ accounts: MailAccountStatus[] }>('/mail/accounts');
export const searchMail = (input: {
  account: string;
  query: string;
  maxResults?: number;
  page?: string;
}) => request<MailPayload>('/mail/search', { method: 'POST', body: JSON.stringify(input) });
export const getMailThread = (input: { account: string; threadId: string }) =>
  request<MailPayload>('/mail/thread', { method: 'POST', body: JSON.stringify(input) });
export const getMailLabels = (account: string) =>
  request<MailPayload>('/mail/labels', { method: 'POST', body: JSON.stringify({ account }) });
export const modifyMailLabels = (input: {
  account: string;
  threadId: string;
  add?: string[];
  remove?: string[];
}) => request<MailPayload>('/mail/labels/modify', { method: 'POST', body: JSON.stringify(input) });
export interface DraftInput {
  account: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string;
  threadId?: string;
  replyAll?: boolean;
}
export const createMailDraft = (input: DraftInput) =>
  request<MailPayload>('/mail/drafts', { method: 'POST', body: JSON.stringify(input) });
export const listMailDrafts = (account: string) =>
  request<MailPayload>('/mail/drafts/list', {
    method: 'POST',
    body: JSON.stringify({ account, maxResults: 25 }),
  });
export const authorizeMailSend = (account: string, draftId: string) =>
  request<{ confirmationToken: string; expiresAt: string; draft: MailPayload }>(
    '/mail/drafts/authorize-send',
    {
      method: 'POST',
      body: JSON.stringify({ account, draftId }),
    },
  );
export const sendMailDraft = (account: string, draftId: string, confirmationToken: string) =>
  request<MailPayload>('/mail/drafts/send', {
    method: 'POST',
    body: JSON.stringify({ account, draftId, confirmationToken }),
  });

export interface ThemeSyncResult {
  theme: 'light' | 'dark';
  results: Array<{
    service: 'openclaw' | 'code' | 'nextcloud';
    status: 'updated' | 'failed';
    attempts: number;
    error?: string;
  }>;
}

export const syncWorkspaceTheme = (theme: 'light' | 'dark') =>
  request<ThemeSyncResult>('/theme/sync', {
    method: 'POST',
    body: JSON.stringify({ theme }),
  });

export async function downloadMailAttachment(input: {
  account: string;
  messageId: string;
  attachmentId: string;
  filename: string;
}): Promise<void> {
  const response = await fetch(`${API_URL}/mail/attachment`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiFailure(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = input.filename;
  link.rel = 'noopener';
  link.click();
  URL.revokeObjectURL(url);
}

export interface SecretInventory {
  checkedAt: string;
  entries: Array<{ name: string; updatedAt: string | null; allowedHosts: string[] }>;
}
export const getSecretInventory = () =>
  request<SecretInventory>('/connections/secrets', { cache: 'no-store' });
export const setSecret = (input: { name: string; value: string; allowedHosts: string[] }) =>
  request<SecretInventory>('/connections/secrets', {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify(input),
  });
