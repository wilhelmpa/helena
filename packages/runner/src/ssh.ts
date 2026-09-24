import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, rm, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RunnerConfig } from './config';

// The SSH keys Helena grants an agent reach git, and nothing else: before each run and
// chat answer the runner writes exactly the granted keys into a directory of the agent's
// own (0700, each key 0600) and points git at them with GIT_SSH_COMMAND. A key revoked in
// Helena is gone from the directory before the next command starts. The keys never enter
// a prompt; git reads them from the files.

export interface SshKey {
  id: number;
  label: string;
  // Changes whenever the key pair is regenerated.
  updatedAt: string;
  privateKey: string;
}

// Where the agent's keys live: HELENA_SSH_DIR, else inside the Hermes profile, else a
// directory of this agent under the runner's home.
export function sshDir(config: Pick<RunnerConfig, 'env' | 'apiKey'>): string {
  const explicit = config.env.HELENA_SSH_DIR ?? process.env.HELENA_SSH_DIR;
  if (explicit) return explicit;
  const hermesHome = config.env.HERMES_HOME ?? process.env.HERMES_HOME;
  if (hermesHome) return join(hermesHome, 'helena-ssh');
  const agent = createHash('sha256').update(config.apiKey).digest('hex').slice(0, 12);
  return join(homedir(), '.helena-ssh', agent);
}

const KEY_FILE = /^id_(\d+)$/;

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// The ssh command git runs: only the listed keys, no ssh config or agent, and host keys
// learnt on first contact into the directory's own known_hosts.
export function gitSshCommand(dir: string, keyFiles: string[]): string {
  return [
    'ssh',
    '-F /dev/null',
    '-o IdentitiesOnly=yes',
    '-o IdentityAgent=none',
    '-o BatchMode=yes',
    '-o StrictHostKeyChecking=accept-new',
    `-o UserKnownHostsFile=${quote(join(dir, 'known_hosts'))}`,
    ...keyFiles.map((file) => `-i ${quote(file)}`),
  ].join(' ');
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${dir} is not a directory`);
  await chmod(dir, 0o700);
}

// Makes the directory hold exactly `keys` and answers the environment git needs. No keys
// leave no GIT_SSH_COMMAND, so git behaves as it would without Helena.
export async function applySshKeys(dir: string, keys: SshKey[]): Promise<Record<string, string>> {
  await ensureDir(dir);
  const wanted = new Map(keys.map((key) => [`id_${key.id}`, key]));
  for (const name of await readdir(dir)) {
    if (KEY_FILE.test(name) && !wanted.has(name)) await rm(join(dir, name), { force: true });
  }
  const files: string[] = [];
  for (const [name, key] of wanted) {
    const target = join(dir, name);
    const temporary = join(dir, `.${name}.tmp`);
    const content = key.privateKey.endsWith('\n') ? key.privateKey : `${key.privateKey}\n`;
    await rm(temporary, { force: true });
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    files.push(target);
  }
  return files.length > 0 ? { GIT_SSH_COMMAND: gitSshCommand(dir, files) } : {};
}
