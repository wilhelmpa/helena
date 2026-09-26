import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export const LOCAL_MODELS = Object.freeze({
  'local-qwen36': 'Qwen3.6-35B-A3B-MTP-GGUF',
  'local-qwen38': 'Qwen3.8-27B-GGUF',
});
export const LOCAL_API = 'http://127.0.0.1:3000/owner-terminal/local';

function statePath(root, kind, name) {
  if (!Object.hasOwn(LOCAL_MODELS, kind) || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) throw new Error('local_terminal_kind_invalid');
  return path.join(root, `${kind}-${name}.json`);
}

async function privateDirectory(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('local_terminal_state_invalid');
}

export async function readLocalState(root, kind, name) {
  await privateDirectory(root);
  const handle = await open(statePath(root, kind, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 8192) throw new Error('local_terminal_state_invalid');
    const state = JSON.parse(await handle.readFile('utf8'));
    if (state.kind !== kind || state.name !== name || state.model !== LOCAL_MODELS[kind] ||
        typeof state.token !== 'string' || state.token.length > 4096 ||
        !Number.isFinite(state.expiresAt) || state.expiresAt <= Date.now() / 1000) throw new Error('local_terminal_access_expired');
    return state;
  } finally { await handle.close(); }
}

export async function prepareLocalModel(root, kind, name, token, sessionId, fetchImpl = fetch) {
  await privateDirectory(root);
  try {
    const current = await readLocalState(root, kind, name);
    if (current.sessionId === sessionId && current.expiresAt > Date.now() / 1000 + 60) return;
  } catch { /* A new terminal proof replaces missing/expired state atomically. */ }
  const response = await fetchImpl(`${LOCAL_API}/${kind}/bootstrap`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-terminal-token': token },
    body: JSON.stringify({ name }), redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('local_terminal_bootstrap_failed');
  const value = await response.json();
  if (typeof value.token !== 'string' || value.token.length > 4096 || value.model !== LOCAL_MODELS[kind] ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() / 1000 || value.expiresAt > Date.now() / 1000 + 12 * 3600) throw new Error('local_terminal_bootstrap_invalid');
  const file = statePath(root, kind, name);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ ...value, kind, name, sessionId }));
    await handle.close();
    await rename(temporary, file);
  } finally { await handle.close().catch(() => {}); await rm(temporary, { force: true }); }
}

export async function removeLocalState(root, kind, name) {
  await rm(statePath(root, kind, name), { force: true });
}

export function localCodexArguments(kind) {
  if (!Object.hasOwn(LOCAL_MODELS, kind)) throw new Error('local_terminal_kind_invalid');
  return [
    '--no-daemon', '-m', LOCAL_MODELS[kind],
    '-c', 'model_provider="helena_local"',
    '-c', `model_providers.helena_local={name="Helena local",base_url="${LOCAL_API}/${kind}/v1",wire_api="responses",env_key="HELENA_OWNER_LOCAL_TOKEN",requires_openai_auth=false,supports_websockets=false,request_max_retries=0,stream_max_retries=0,stream_idle_timeout_ms=120000}`,
    // Local Responses accepts client function/custom tools, not agent namespaces.
    '-c', 'features.multi_agent=false',
    '-c', 'web_search="disabled"', '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false',
  ];
}
