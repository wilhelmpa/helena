import { intEnv } from './env';
import {
  parseSyncResponse,
  parseTriageResponse,
  type InboxSyncSource,
  type InboxTriageResponse,
} from './hub-inbox-contract';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface HubInboxConfig {
  baseUrl: string;
  token: string;
  teamId: number;
  accounts: string[];
  syncIntervalMs: number;
  timeoutMs: number;
}

export function hubInboxConfig(): HubInboxConfig | null {
  const baseUrl = process.env.INBOX_INTEGRATION_URL?.trim().replace(/\/+$/, '') ?? '';
  const token = process.env.INBOX_INTEGRATION_TOKEN?.trim() ?? '';
  const teamId = Number(process.env.INBOX_TEAM_ID);
  if (!baseUrl || !token || !Number.isInteger(teamId) || teamId <= 0) return null;
  return {
    baseUrl,
    token,
    teamId,
    accounts: (process.env.INBOX_ACCOUNTS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    syncIntervalMs: intEnv('INBOX_SYNC_INTERVAL_MS', 300_000),
    timeoutMs: intEnv('INBOX_INTEGRATION_TIMEOUT_MS', 30_000),
  };
}

export async function syncInbox(
  config: HubInboxConfig,
  cursors: Record<string, string | null>,
): Promise<InboxSyncSource[]> {
  const sources = parseSyncResponse(
    await requestJson(config, '/api/inbox/sync', {
      schemaVersion: 1,
      accounts: config.accounts,
      cursors,
      limitPerAccount: 50,
    }),
  );
  if (config.accounts.length > 0) {
    const allowed = new Set(config.accounts);
    if (sources.some((source) => !allowed.has(source.account))) {
      throw new Error('Integration returned an unrequested account');
    }
  }
  const sourceKeys = sources.map((source) => `${source.channel}\0${source.account}`);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new Error('Integration returned duplicate sources');
  }
  return sources;
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
