import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RuntimeRequest } from './readers';

// The runner's side of updating the Hermes installation: it writes a request into the
// update spool, which a root helper watches (deployment/volition-stack/native/hermes-update),
// and reads the helper's status back. The spool is in the runner's own Hermes home, which no
// isolated agent reaches. Helena only sends an apply after the owner approved it.

const CHECK_TIMEOUT_MS = 150_000;
const POLL_MS = 1_000;

export function updateSpool(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.HELENA_HERMES_UPDATE_SPOOL) return env.HELENA_HERMES_UPDATE_SPOOL;
  return env.HERMES_HOME ? join(env.HERMES_HOME, 'run', 'helena-update') : null;
}

interface Status {
  id: string | null;
  action?: string;
  state: 'running' | 'done' | 'failed';
  ok?: boolean;
  result?: unknown;
  error?: string;
  log?: string;
}

async function readStatus(spool: string): Promise<Status | null> {
  try {
    const path = join(spool, 'status.json');
    if ((await lstat(path)).isSymbolicLink()) return null;
    return JSON.parse(await readFile(path, 'utf8')) as Status;
  } catch {
    return null;
  }
}

async function writeRequest(spool: string, request: Record<string, unknown>): Promise<void> {
  await mkdir(spool, { recursive: true, mode: 0o770 });
  const temp = join(spool, `.request-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(request), { mode: 0o660, flag: 'wx' });
  await rename(temp, join(spool, 'request.json'));
}

export async function runtimeUpdate(
  request: Extract<RuntimeRequest, { op: 'runtime.update' }>,
  spool = updateSpool(),
): Promise<unknown> {
  if (!spool) throw new Error('This runner has no update spool');
  if (request.action === 'status') return (await readStatus(spool)) ?? { id: null, state: 'idle' };
  const id = randomUUID();
  if (request.action === 'apply') {
    if (!request.target) throw new Error('An update needs a target');
    await writeRequest(spool, { id, action: 'apply', target: request.target });
    return { id, state: 'started' };
  }
  await writeRequest(spool, { id, action: 'check', ...(request.offline ? { offline: true } : {}) });
  const deadline = Date.now() + CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const status = await readStatus(spool);
    if (status?.id === id && status.state !== 'running') {
      if (!status.ok) throw new Error(status.error ?? 'The update check failed');
      return status.result;
    }
  }
  throw new Error('The update helper did not answer; is helena-hermes-update.path enabled?');
}
