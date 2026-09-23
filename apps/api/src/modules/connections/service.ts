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
export const syncWorkspaceTheme = (body: unknown) => json<ThemeSyncDto>('/api/theme', body);

export interface SecretInventoryDto {
  checkedAt: string;
  entries: Array<{ name: string; updatedAt: string | null; allowedHosts: string[] }>;
}
export const secretInventory = () =>
  bridgeConfigured()
    ? json<SecretInventoryDto>('/api/secrets')
    : Promise.resolve({ checkedAt: new Date().toISOString(), entries: [] });
export const secretSet = (body: unknown) => json<SecretInventoryDto>('/api/secrets', body);

export type VaultAccessStatus = 'protected' | 'reachable' | 'unavailable' | 'unconfigured';

export interface VaultStatusDto {
  checkedAt: string;
  accessUrl: string | null;
  accessStatus: VaultAccessStatus;
  httpStatus: number | null;
  serviceHealthExposed: false;
  secretValuesExposed: false;
}

export function parseVaultAccessUrl(raw: string): URL | null {
  if (!raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    return null;
  }
  return url;
}

export function classifyVaultHttpStatus(
  status: number,
): Exclude<VaultAccessStatus, 'unconfigured'> {
  if (status >= 500) return 'unavailable';
  return status === 401 || status === 403 || (status >= 300 && status < 400)
    ? 'protected'
    : 'reachable';
}

export async function vaultStatus(
  fetcher: typeof fetch = fetch,
  rawUrl = process.env.VAULT_URL || '',
): Promise<VaultStatusDto> {
  const checkedAt = new Date().toISOString();
  const url = parseVaultAccessUrl(rawUrl);
  const base = {
    checkedAt,
    accessUrl: url?.toString() ?? null,
    serviceHealthExposed: false as const,
    secretValuesExposed: false as const,
  };
  if (!url) return { ...base, accessStatus: 'unconfigured', httpStatus: null };

  try {
    const response = await fetcher(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'text/html' },
    });
    return {
      ...base,
      accessStatus: classifyVaultHttpStatus(response.status),
      httpStatus: response.status,
    };
  } catch {
    return { ...base, accessStatus: 'unavailable', httpStatus: null };
  }
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
