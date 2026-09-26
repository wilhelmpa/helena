import { randomUUID } from 'node:crypto';
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
//
// Next to the keys: the host keys Helena pins (GitHub's, as GitHub publishes them), an ssh
// configuration and the proxy command. An isolated agent reaches the internet only through
// the egress proxy, which opens ports 80 and 443, so ssh goes through it (an HTTP CONNECT),
// and to GitHub on port 443 (ssh.github.com, GitHub's SSH over the HTTPS port).

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
export const PINNED_HOSTS_FILE = 'known_hosts.pinned';
export const SSH_CONFIG_FILE = 'ssh_config';
export const PROXY_SCRIPT_FILE = 'proxy-connect.py';

// GitHub's SSH host keys as https://api.github.com/meta publishes them (fingerprints
// SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU ed25519,
// SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM ecdsa,
// SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s rsa; checked against ssh-keyscan of
// github.com:22 and ssh.github.com:443 on 2026-09-25). A host key that differs is refused,
// never learnt.
export const PINNED_KNOWN_HOSTS = [
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=',
  'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=',
];

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ssh's ProxyCommand: through the HTTP proxy of the command's environment (an isolated
// agent's egress proxy) with CONNECT, or straight to the host where there is none. Python's
// standard library only, which every unit has.
export const PROXY_SCRIPT = `# Written by the Helena runner (packages/runner/src/ssh.ts): ssh's ProxyCommand.
import os, select, socket, sys
from urllib.parse import urlsplit


def write_all(data):
    while data:
        data = data[os.write(1, data):]


def connect(host, port):
    names = ('https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY')
    proxy = next((os.environ[name] for name in names if os.environ.get(name)), '')
    if not proxy:
        return socket.create_connection((host, port), timeout=30), b''
    url = urlsplit(proxy if '://' in proxy else 'http://' + proxy)
    sock = socket.create_connection((url.hostname, url.port or 80), timeout=30)
    target = ('[%s]:%d' if ':' in host else '%s:%d') % (host, port)
    sock.sendall(('CONNECT %s HTTP/1.1\\r\\nHost: %s\\r\\n\\r\\n' % (target, target)).encode())
    head = b''
    while b'\\r\\n\\r\\n' not in head:
        chunk = sock.recv(4096)
        if not chunk or len(head) > 65536:
            sys.exit('helena ssh proxy: the proxy closed the connection')
        head += chunk
    status = head.split(b'\\r\\n', 1)[0]
    if status.split()[1:2] != [b'200']:
        sys.exit('helena ssh proxy: ' + status.decode('latin-1'))
    return sock, head.split(b'\\r\\n\\r\\n', 1)[1]


def main():
    sock, early = connect(sys.argv[1], int(sys.argv[2]))
    sock.settimeout(None)
    write_all(early)
    reading = True
    while True:
        ready, _, _ = select.select(([0] if reading else []) + [sock], [], [])
        if 0 in ready:
            data = os.read(0, 65536)
            if data:
                sock.sendall(data)
            else:
                reading = False
                try:
                    sock.shutdown(socket.SHUT_WR)
                except OSError:
                    pass
        if sock in ready:
            data = sock.recv(65536)
            if not data:
                return
            write_all(data)


main()
`;

export function sshConfig(dir: string): string {
  return [
    '# Written by the Helena runner (packages/runner/src/ssh.ts); replaced before every run.',
    'Host github.com',
    '  HostName ssh.github.com',
    '  Port 443',
    '  HostKeyAlias github.com',
    'Host *',
    `  ProxyCommand python3 -I ${quote(join(dir, PROXY_SCRIPT_FILE))} %h %p`,
    '',
  ].join('\n');
}

export interface SshCommandOptions {
  // A host whose key is not pinned is refused rather than learnt (a clone job).
  strict?: boolean;
  // Where host keys learnt on first contact go; the directory's own known_hosts by default.
  knownHosts?: string;
}

// The ssh command git runs: only the listed keys, no agent, Helena's own configuration, the
// pinned host keys, and host keys learnt on first contact into the directory's own
// known_hosts (or, strict, none learnt at all).
export function gitSshCommand(
  dir: string,
  keyFiles: string[],
  options: SshCommandOptions = {},
): string {
  return [
    'ssh',
    `-F ${quote(join(dir, SSH_CONFIG_FILE))}`,
    '-o IdentitiesOnly=yes',
    '-o IdentityAgent=none',
    '-o BatchMode=yes',
    `-o StrictHostKeyChecking=${options.strict ? 'yes' : 'accept-new'}`,
    `-o GlobalKnownHostsFile=${quote(join(dir, PINNED_HOSTS_FILE))}`,
    `-o UserKnownHostsFile=${quote(options.knownHosts ?? join(dir, 'known_hosts'))}`,
    ...keyFiles.map((file) => `-i ${quote(file)}`),
  ].join(' ');
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${dir} is not a directory`);
  await chmod(dir, 0o700);
}

// Replaces a file in one step, 0600, never through a link someone left in its place.
async function writePrivate(dir: string, name: string, content: string): Promise<string> {
  const target = join(dir, name);
  const temporary = join(dir, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
}

// The pinned host keys, the ssh configuration and the proxy command, written again with
// every delivery so a runner update reaches them.
export async function writeSshSupport(dir: string): Promise<void> {
  await ensureDir(dir);
  await writePrivate(dir, PINNED_HOSTS_FILE, `${PINNED_KNOWN_HOSTS.join('\n')}\n`);
  await writePrivate(dir, SSH_CONFIG_FILE, sshConfig(dir));
  await writePrivate(dir, PROXY_SCRIPT_FILE, PROXY_SCRIPT);
}

// The key files the directory holds now, in the order of their ids.
export async function sshKeyFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((name) => KEY_FILE.test(name))
    .sort((a, b) => Number(KEY_FILE.exec(a)![1]) - Number(KEY_FILE.exec(b)![1]))
    .map((name) => join(dir, name));
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
    const content = key.privateKey.endsWith('\n') ? key.privateKey : `${key.privateKey}\n`;
    files.push(await writePrivate(dir, name, content));
  }
  if (files.length === 0) return {};
  await writeSshSupport(dir);
  return { GIT_SSH_COMMAND: gitSshCommand(dir, files) };
}
