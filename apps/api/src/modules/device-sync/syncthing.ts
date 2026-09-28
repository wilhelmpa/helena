import { lstat, readFile } from 'node:fs/promises';
import { HttpError } from '#shared/lib';

export type SyncthingProblem = 'unconfigured' | 'unreachable';

// Syncthing has no API key for Plan, refuses it, or does not answer. The write routes
// answer 503 with it; the status route reports the reason instead.
export class SyncthingUnavailable extends HttpError {
  constructor(readonly reason: SyncthingProblem) {
    super(
      503,
      reason === 'unconfigured' ? 'Syncthing is not set up' : 'Syncthing is not reachable',
    );
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Both are read on every call, so a test can point the API at a server and a key of
// its own.
function baseUrl(): URL {
  const url = URL.parse(process.env.SYNCTHING_URL?.trim() || 'http://127.0.0.1:8384');
  if (!url || url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username) {
    throw new SyncthingUnavailable('unconfigured');
  }
  return url;
}

// A key must be readable by its owner only. systemd's own credential directory is the
// exception: on a native boot it presents LoadCredential files as 0440 (0400 inside a
// container) and guards the directory itself, so group read is fine there. Without this the
// live API (LoadCredential=syncthing_api_key) took Syncthing for "not set up" (28.09.).
function secretModeMask(file: string): number {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  return dir && file.startsWith(`${dir}/`) ? 0o037 : 0o077;
}

async function apiKey(): Promise<string> {
  const file = process.env.SYNCTHING_API_KEY_FILE?.trim() || '/run/secrets/syncthing_api_key';
  const stat = await lstat(file).catch(() => null);
  if (!stat?.isFile() || (stat.mode & secretModeMask(file)) !== 0) {
    throw new SyncthingUnavailable('unconfigured');
  }
  const key = (await readFile(file, 'utf8').catch(() => '')).trim();
  if (key.length < 32 || key.length > 256) throw new SyncthingUnavailable('unconfigured');
  return key;
}

async function syncthingRequest(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const key = await apiKey();
  const response = await fetch(new URL(path, baseUrl()), {
    method: init.method ?? 'GET',
    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    throw new SyncthingUnavailable('unreachable');
  });
  if (response.status === 401 || response.status === 403) {
    throw new SyncthingUnavailable('unconfigured');
  }
  return response;
}

async function assertOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const detail = (await response.text().catch(() => '')).trim().slice(0, 200);
  throw new HttpError(502, `Syncthing answered ${response.status}${detail ? `: ${detail}` : ''}`);
}

export async function syncthingJson<T>(path: string): Promise<T> {
  return (await assertOk(await syncthingRequest(path))).json() as Promise<T>;
}

// The same, with null for an object Syncthing does not know.
export async function syncthingFind<T>(path: string): Promise<T | null> {
  const response = await syncthingRequest(path);
  if (response.status === 404) return null;
  return (await assertOk(response)).json() as Promise<T>;
}

export async function syncthingWrite(path: string, method: string, body?: unknown): Promise<void> {
  await assertOk(await syncthingRequest(path, { method, body }));
}

// The PNG Syncthing renders for a text, as a data URL the page shows directly.
export async function syncthingQrCode(text: string): Promise<string> {
  const response = await assertOk(await syncthingRequest(`/qr/?text=${encodeURIComponent(text)}`));
  return `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
}
