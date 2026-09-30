import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AVA_KINDS = new Set(['claude', 'codex', 'helena-dev-claude', 'helena-dev-codex', 'local-qwen36', 'local-qwen38', 'local-flash']);
const nativeApi = 'http://127.0.0.1:3000';
const script = fileURLToPath(import.meta.url);
const runtimeRoot = '/run/volition-owner-terminal/ava-tools';

function stateFile(root, kind, name) {
  if (!AVA_KINDS.has(kind) || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) throw new Error('Invalid Ava terminal');
  return path.join(root, `${kind}-${name}.json`);
}

async function privateRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('Invalid Ava terminal state');
}

export async function readAvaState(root, kind, name) {
  await privateRoot(root);
  const handle = await open(stateFile(root, kind, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 8192) throw new Error('Invalid Ava terminal state');
    const value = JSON.parse(await handle.readFile('utf8'));
    if (value.kind !== kind || value.name !== name || typeof value.token !== 'string' || value.token.length > 4096 || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() / 1000) throw new Error('Ava terminal access expired');
    return value;
  } finally { await handle.close(); }
}

export async function prepareAvaTools(root, kind, name, token, sessionId, fetchImpl = fetch) {
  await privateRoot(root);
  const file = stateFile(root, kind, name);
  const response = await fetchImpl(`${nativeApi}/owner-terminal/ava/${kind}/bootstrap`, {
    method: 'POST', headers: { 'x-owner-terminal-token': token }, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Ava tools bootstrap failed');
  const value = await response.json();
  if (typeof value.token !== 'string' || value.token.length > 4096 || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() / 1000 || value.expiresAt > Date.now() / 1000 + 12 * 3600) throw new Error('Invalid Ava tools bootstrap');
  const temporary = file + '.' + crypto.randomUUID();
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ ...value, kind, name, sessionId }));
    await handle.close();
    await rename(temporary, file);
  } finally { await handle.close().catch(() => {}); await rm(temporary, { force: true }); }
}

export const removeAvaState = (root, kind, name) => rm(stateFile(root, kind, name), { force: true });
export function handoff(ownerHome) {
  return `Du bist Ava, der Home-Agent des Owners, auch in diesem Terminal. Nutze die volition-MCP-Werkzeuge für Projekte, Root und den Entwicklungsablauf. Audit und der Root-Hauptschalter gelten auf jeder Laufzeit. Die gemeinsame Handoff-Datei ist ${ownerHome}/volition/CLAUDE.md; lies daraus und aus docs/ nur gezielt die für den Auftrag nötigen Regeln. Verwende den Skill ava-entwicklung. Intern heißen neue Bezeichner volition. Ein Dry-Run erlaubt keinen echten Deploy.`;
}
export function avaMcpConfig(kind, name) {
  stateFile(runtimeRoot, kind, name);
  return { mcpServers: { volition: { command: '/usr/bin/node', args: [script, 'mcp', kind, name] } } };
}
export function avaCodexArguments(kind, name, ownerHome) {
  const server = avaMcpConfig(kind, name).mcpServers.volition;
  return ['-c', `mcp_servers.volition={command=${JSON.stringify(server.command)},args=${JSON.stringify(server.args)},tool_timeout_sec=180}`,
    '-c', `developer_instructions=${JSON.stringify(handoff(ownerHome))}`];
}

export async function forwardAvaMessage(root, kind, name, message, fetchImpl = fetch) {
  const state = await readAvaState(root, kind, name);
  const response = await fetchImpl(`${nativeApi}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26', 'x-volition-owner-tools': state.token },
    body: JSON.stringify(message), redirect: 'error', signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error('Ava tools access unavailable or revoked');
  if (response.status === 202) return [];
  const content = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream'))
    return content.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
  return [JSON.parse(content)];
}

if (process.argv[1] === script) {
  const [mode, kind, name] = process.argv.slice(2);
  if (mode === 'config') process.stdout.write(JSON.stringify(avaMcpConfig(kind, name)));
  else if (mode === 'launch') {
    const args = avaCodexArguments(kind, name, process.env.HOME);
    const binary = kind.includes('claude') ? `${process.env.HOME}/.local/bin/claude` : '/usr/local/bin/codex';
    const cli = kind.includes('claude') ? ['--dangerously-skip-permissions', '--add-dir', `${process.env.HOME}/volition`, '--append-system-prompt', handoff(process.env.HOME), '--mcp-config', JSON.stringify(avaMcpConfig(kind, name)), ...process.argv.slice(5)] : ['--dangerously-bypass-approvals-and-sandbox', ...args, ...process.argv.slice(5)];
    const child = spawn(binary, cli, { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => { process.exitCode = code ?? 1; });
    child.on('error', () => { process.stderr.write('Ava terminal could not start.\n'); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  } else if (mode === 'mcp') {
    const lines = createInterface({ input: process.stdin });
    for await (const line of lines) {
      let message;
      try {
        message = JSON.parse(line);
        for (const reply of await forwardAvaMessage(runtimeRoot, kind, name, message)) process.stdout.write(JSON.stringify(reply) + '\n');
      } catch {
        if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'Ava tools unavailable. Renew the owner terminal grant and reopen the tab.' } }) + '\n');
      }
    }
  } else { process.stderr.write('Unknown Ava terminal mode.\n'); process.exitCode = 64; }
}
