import { intEnv } from './env';
import { parseTriageResponse, type InboxTriageResponse } from './hub-inbox-contract';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface HubInboxConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

export function hubInboxConfig(): HubInboxConfig | null {
  const baseUrl = process.env.INBOX_INTEGRATION_URL?.trim().replace(/\/+$/, '') ?? '';
  const token = process.env.INBOX_INTEGRATION_TOKEN?.trim() ?? '';
  if (!baseUrl || !token) return null;
  return {
    baseUrl,
    token,
    timeoutMs: intEnv('INBOX_INTEGRATION_TIMEOUT_MS', 30_000),
  };
}

export async function startTriage(
  config: HubInboxConfig,
  payload: Record<string, unknown>,
): Promise<InboxTriageResponse> {
  return parseTriageResponse(await requestJson(config, '/api/inbox/triage', payload));
}

export async function pollTriage(
  config: HubInboxConfig,
  runId: string,
): Promise<InboxTriageResponse> {
  const encoded = encodeURIComponent(runId);
  return parseTriageResponse(await requestJson(config, `/api/inbox/triage/${encoded}`));
}

async function requestJson(
  config: HubInboxConfig,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (encoded && Buffer.byteLength(encoded) > MAX_REQUEST_BYTES)
    throw new Error('Request too large');
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: encoded ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${config.token}`,
      ...(encoded ? { 'content-type': 'application/json' } : {}),
    },
    body: encoded,
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error('Response too large');
  if (!response.ok) throw new Error(`Integration returned HTTP ${response.status}`);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Integration returned invalid JSON');
  }
}
