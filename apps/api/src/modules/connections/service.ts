import { HttpError } from '#shared/lib';

const DEFAULT_TIMEOUT_MS = 30_000;

type ConnectionStatus =
  'connected' | 'available' | 'configured' | 'disabled' | 'unavailable' | 'unsupported' | 'error';
export interface ConnectionsDto {
  checkedAt: string;
  items: Array<{
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
  }>;
}
export interface MailAccountsDto {
  accounts: Array<{
    account: string;
    status: ConnectionStatus;
    lastCheckedAt: string;
    lastError: string | null;
  }>;
}
export interface ThemeSyncDto {
  theme: 'light' | 'dark';
  results: Array<{
    service: 'agent_runtime' | 'code' | 'nextcloud';
    status: 'updated' | 'failed';
    attempts: number;
    error?: string;
  }>;
}

function bridgeConfigured() {
  return Boolean(
    process.env.CONNECTIONS_INTEGRATION_URL?.trim() &&
    process.env.CONNECTIONS_INTEGRATION_TOKEN?.trim(),
  );
}

function bridgeConfig() {
  const rawUrl = process.env.CONNECTIONS_INTEGRATION_URL || '';
  const token = process.env.CONNECTIONS_INTEGRATION_TOKEN || '';
  if (!rawUrl || !token) throw new HttpError(503, 'Connections integration is not configured');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(503, 'Connections integration URL is invalid');
  }
  const privateHost =
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname === 'hub' ||
    /^10\./.test(url.hostname) ||
    /^192\.168\./.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
  if (
    url.protocol !== 'http:' ||
    !privateHost ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new HttpError(503, 'Connections integration URL must be a private HTTP endpoint');
  }
  return { url, token };
}

async function bridge(path: string, init: RequestInit = {}): Promise<Response> {
  const config = bridgeConfig();
  const timeout = Number(process.env.CONNECTIONS_INTEGRATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const response = await fetch(new URL(path, config.url), {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(
      Number.isFinite(timeout) ? Math.min(Math.max(timeout, 1_000), 60_000) : DEFAULT_TIMEOUT_MS,
    ),
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  }).catch(() => {
    throw new HttpError(502, 'Connections integration is unavailable');
  });
  return response;
}

async function json<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await bridge(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : 'Connector request failed';
    throw new HttpError(response.status >= 500 ? 502 : response.status, message);
  }
  return payload as T;
}

export const connectionsSnapshot = () =>
  bridgeConfigured()
    ? json<ConnectionsDto>('/api/connections')
    : Promise.resolve({ checkedAt: new Date().toISOString(), items: [] });
export const connectionsAction = (body: unknown) =>
  json<ConnectionsDto>('/api/connections/actions', body);
export const mailAccounts = () =>
  bridgeConfigured()
    ? json<MailAccountsDto>('/api/mail/accounts', {})
    : Promise.resolve({ accounts: [] });
export const mailSearch = (body: unknown) => json('/api/mail/search', body);
export const mailThread = (body: unknown) => json('/api/mail/thread', body);
export const mailLabels = (body: unknown) => json('/api/mail/labels', body);
export const mailModifyLabels = (body: unknown) => json('/api/mail/labels/modify', body);
export const mailCreateDraft = (body: unknown) => json('/api/mail/drafts', body);
export const mailListDrafts = (body: unknown) => json('/api/mail/drafts/list', body);
export const mailAuthorizeSend = (body: unknown) => json('/api/mail/drafts/authorize-send', body);
export const mailSendDraft = (body: unknown) => json('/api/mail/drafts/send', body);
export const syncWorkspaceTheme = (body: unknown) => json<ThemeSyncDto>('/api/theme', body);

export async function mailAttachment(body: unknown): Promise<Response> {
  const response = await bridge('/api/mail/attachment', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : 'Attachment download failed';
    throw new HttpError(response.status >= 500 ? 502 : response.status, message);
  }
  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', response.headers.get('Content-Disposition') || 'attachment');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: 200, headers });
}

export interface ProjectFileListDto {
  project: string;
  path: string;
  items: Array<{
    name: string;
    path: string;
    kind: 'folder' | 'file';
    sizeBytes: number | null;
    contentType: string | null;
    updatedAt: string | null;
    previewable: boolean;
  }>;
}

export interface ProjectFileTextDto {
  project: string;
  path: string;
  content: string;
  sizeBytes: number;
}

export const projectFilesJson = <T>(path: string, body: unknown) => json<T>(path, body);

export async function projectFileDownload(body: unknown): Promise<Response> {
  const response = await bridge('/api/files/download', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : 'File download failed';
    throw new HttpError(response.status >= 500 ? 502 : response.status, message);
  }
  const headers = new Headers();
  headers.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Content-Disposition', response.headers.get('Content-Disposition') || 'attachment');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: 200, headers });
}
