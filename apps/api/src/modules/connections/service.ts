import { HttpError } from '#shared/lib';

const DEFAULT_TIMEOUT_MS = 30_000;

type ConnectionStatus =
  'connected' | 'available' | 'configured' | 'disabled' | 'unavailable' | 'unsupported' | 'error';
export interface ConnectionsDto {
  checkedAt: string;
  configured: boolean;
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

// The connections service answers the list without `configured`; the API adds it, so the
// page can tell "no service on this server" from "nothing connected".
type BridgeSnapshot = Omit<ConnectionsDto, 'configured'>;

export const connectionsSnapshot = async (): Promise<ConnectionsDto> =>
  bridgeConfigured()
    ? { ...(await json<BridgeSnapshot>('/api/connections')), configured: true }
    : { checkedAt: new Date().toISOString(), configured: false, items: [] };
export const connectionsAction = async (body: unknown): Promise<ConnectionsDto> => ({
  ...(await json<BridgeSnapshot>('/api/connections/actions', body)),
  configured: true,
});
