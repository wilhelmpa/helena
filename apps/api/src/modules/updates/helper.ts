import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The root helper that knows the host and does the updates (helena-update,
// deployment/volition-stack/native/updates). The API never gets root: it writes a request
// file into the helper's spool, systemd starts the helper for it (helena-update.path), and
// the helper answers with a status file in a folder only root writes.
//
//   <spool>/tmp/        the API writes a request here first,
//   <spool>/requests/   then moves it here (one file per request, <uuid>.json),
//   <spool>/status/     the helper's answers (<uuid>.json), root's.
//
// Off (every call answers "not installed") unless the spool exists; HELENA_UPDATE_SPOOL
// names it, /var/lib/helena-updates/spool by default.

const STATUS_MAX_BYTES = 2 * 1024 * 1024;
const POLL_MS = 500;

export function updateSpool(): string {
  return process.env.HELENA_UPDATE_SPOOL?.trim() || '/var/lib/helena-updates/spool';
}

export class HelperUnavailableError extends Error {
  constructor(message = 'The update helper is not installed') {
    super(message);
    this.name = 'HelperUnavailableError';
  }
}

export interface HelperStatus {
  id: string;
  action: string;
  state: 'running' | 'done' | 'failed';
  ok?: boolean;
  result?: Record<string, unknown> | null;
  error?: string | null;
  log?: string | null;
  startedAt?: string;
  finishedAt?: string;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function helperInstalled(): Promise<boolean> {
  const spool = updateSpool();
  return (await isDirectory(join(spool, 'requests'))) && (await isDirectory(join(spool, 'status')));
}

// Hands the helper a request and answers its id. The payload is the action's own fields;
// the helper checks every one of them again against what it inventoried itself.
export async function sendHelperRequest(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<string> {
  if (!(await helperInstalled())) throw new HelperUnavailableError();
  const spool = updateSpool();
  const id = randomUUID();
  const staging = join(spool, 'tmp');
  await mkdir(staging, { recursive: true, mode: 0o770 });
  const temp = join(staging, `${id}.json`);
  await writeFile(temp, JSON.stringify({ ...payload, id, action }), { mode: 0o660, flag: 'wx' });
  await rename(temp, join(spool, 'requests', `${id}.json`));
  return id;
}

// The helper's answer to a request, or null while it has not started one.
export async function readHelperStatus(id: string): Promise<HelperStatus | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const path = join(updateSpool(), 'status', `${id}.json`);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > STATUS_MAX_BYTES) return null;
    const status = JSON.parse(await readFile(path, 'utf8')) as HelperStatus;
    return status && typeof status === 'object' && status.id === id ? status : null;
  } catch {
    return null;
  }
}

// Sends a request and waits for its answer. For the quick actions (inventory); an update is
// followed with readHelperStatus instead.
export async function callHelper(
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 90_000,
): Promise<HelperStatus> {
  const id = await sendHelperRequest(action, payload);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await Bun.sleep(POLL_MS);
    const status = await readHelperStatus(id);
    if (status && status.state !== 'running') return status;
  }
  throw new HelperUnavailableError(
    'The update helper did not answer; is helena-update.path enabled?',
  );
}
