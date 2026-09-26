import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { localCodexArguments, readLocalState } from './owner-local-model.mjs';

// Executed inside the existing owner tmux server, never as a service agent UID.
// Each tab has its own Codex history/config; the owner's cloud login is untouched.
export async function launchLocalCodex(kind, name, {
  runtimeRoot = '/run/volition-owner-terminal/local-models',
  ownerHome = process.env.HOME,
  spawnImpl = spawn,
} = {}) {
  const state = await readLocalState(runtimeRoot, kind, name);
  const stateRoot = path.join(ownerHome, '.local/state/helena-owner-terminal', `${kind}-${name}`);
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const codexHome = path.join(stateRoot, 'codex');
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  const history = await readdir(path.join(codexHome, 'sessions')).catch(() => []);
  const args = localCodexArguments(kind);
  if (history.length) args.push('resume', '--last');
  const child = spawnImpl(path.join(ownerHome, '.local/bin/codex'), args, {
    stdio: 'inherit',
    env: { ...process.env, CODEX_HOME: codexHome, HELENA_OWNER_LOCAL_TOKEN: state.token },
  });
  return child;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
try {
  const [kind, name] = process.argv.slice(2);
  const child = await launchLocalCodex(kind, name);
  child.on('error', () => { process.stderr.write('Local Codex could not start.\n'); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
} catch {
  process.stderr.write('Local terminal access is unavailable. Close this tab with X, renew the terminal grant, then open the local model again.\n');
  process.exitCode = 1;
}
}
