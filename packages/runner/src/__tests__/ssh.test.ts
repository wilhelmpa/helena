import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySshKeys, gitSshCommand, sshConfig, sshDir, PINNED_KNOWN_HOSTS } from '../ssh';
import {
  cloneSshEnv,
  excludeNested,
  jobWorkspace,
  parseWorkspaceJob,
  runWorkspaceJob,
  runWorkspaceJobLocally,
} from '../workspace-job';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'runner-ssh-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const KEY = (n: number) =>
  `-----BEGIN OPENSSH PRIVATE KEY-----\nkey-${n}\n-----END OPENSSH PRIVATE KEY-----`;

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('SSH keys for git', () => {
  it('writes exactly the granted keys, 0600 in a 0700 directory, and points git at them', async () => {
    const dir = join(root, 'helena-ssh');
    const env = await applySshKeys(dir, [
      { id: 7, label: 'GitHub', updatedAt: 'a', privateKey: KEY(7) },
      { id: 9, label: 'Gitea', updatedAt: 'a', privateKey: KEY(9) },
    ]);
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, 'id_7'))).toBe(0o600);
    expect(mode(join(dir, 'id_9'))).toBe(0o600);
    expect(readFileSync(join(dir, 'id_7'), 'utf8')).toBe(`${KEY(7)}\n`);
    expect(env.GIT_SSH_COMMAND).toBe(gitSshCommand(dir, [join(dir, 'id_7'), join(dir, 'id_9')]));
    expect(env.GIT_SSH_COMMAND).toContain('-o IdentitiesOnly=yes');
    expect(env.GIT_SSH_COMMAND).toContain(`-F '${join(dir, 'ssh_config')}'`);
    expect(env.GIT_SSH_COMMAND).toContain('-o StrictHostKeyChecking=accept-new');
    expect(env.GIT_SSH_COMMAND).toContain(
      `-o GlobalKnownHostsFile='${join(dir, 'known_hosts.pinned')}'`,
    );
    expect(env.GIT_SSH_COMMAND).not.toContain('key-7');
    for (const file of ['known_hosts.pinned', 'ssh_config', 'proxy-connect.py']) {
      expect(mode(join(dir, file))).toBe(0o600);
    }

    // A revoked key is gone before the next command; the host keys learnt stay.
    writeFileSync(join(dir, 'known_hosts'), 'github.com ssh-ed25519 AAAA\n');
    const after = await applySshKeys(dir, [
      { id: 9, label: 'Gitea', updatedAt: 'b', privateKey: KEY(90) },
    ]);
    expect(readdirSync(dir).sort()).toEqual([
      'id_9',
      'known_hosts',
      'known_hosts.pinned',
      'proxy-connect.py',
      'ssh_config',
    ]);
    expect(readFileSync(join(dir, 'id_9'), 'utf8')).toContain('key-90');
    expect(after.GIT_SSH_COMMAND).not.toContain('id_7');
  });

  it('sets nothing for git when no key is granted', async () => {
    const dir = join(root, 'none');
    expect(await applySshKeys(dir, [])).toEqual({});
  });

  it('keeps the keys in the agent profile, or apart per agent', () => {
    expect(sshDir({ env: { HERMES_HOME: '/profiles/vol' }, apiKey: 'k' })).toBe(
      '/profiles/vol/helena-ssh',
    );
    expect(sshDir({ env: { HELENA_SSH_DIR: '/x' }, apiKey: 'k' })).toBe('/x');
    const one = sshDir({ env: {}, apiKey: 'agent-one' });
    const two = sshDir({ env: {}, apiKey: 'agent-two' });
    expect(one).not.toBe(two);
  });
});

describe('the clone job', () => {
  it('reads only a clone job with a plain target name', () => {
    const job = {
      op: 'git_clone',
      url: 'git@github.com:acme/site.git',
      folder: 'web',
      name: 'site',
    };
    expect(parseWorkspaceJob(JSON.stringify(job))).toEqual(
      job as ReturnType<typeof parseWorkspaceJob>,
    );
    for (const bad of [
      { ...job, op: 'rm' },
      { ...job, name: '../etc' },
      { ...job, name: '.git' },
      { ...job, url: '--upload-pack=touch /tmp/x' },
    ]) {
      expect(() => parseWorkspaceJob(JSON.stringify(bad))).toThrow();
    }
  });

  it('clones into the area folder and makes the workspace repository ignore it', async () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      });
    const source = join(root, 'source');
    mkdirSync(source);
    git(source, 'init', '-q');
    writeFileSync(join(source, 'README.md'), 'hello\n');
    git(source, 'add', '.');
    git(source, 'commit', '-qm', 'init');
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    git(workspace, 'init', '-q');

    const outcome = await runWorkspaceJob(
      workspace,
      { op: 'git_clone', url: source, folder: 'dev', name: 'site' },
      { ...(process.env as Record<string, string>) },
      new AbortController().signal,
    );
    expect(outcome.status).toBe('success');
    expect(readFileSync(join(workspace, 'dev', 'site', 'README.md'), 'utf8')).toBe('hello\n');
    expect(readFileSync(join(workspace, '.git', 'info', 'exclude'), 'utf8')).toContain(
      '/dev/site/\n',
    );
    const status = git(workspace, 'status', '--porcelain', '--untracked-files=all').toString();
    expect(status).not.toContain('dev/site');

    // A second clone into the same place is refused, and the ignore line is not doubled.
    const again = await runWorkspaceJob(
      workspace,
      { op: 'git_clone', url: source, folder: 'dev', name: 'site' },
      { ...(process.env as Record<string, string>) },
      new AbortController().signal,
    );
    expect(again).toMatchObject({ status: 'failed', error: 'dev/site exists already' });
    expect(await excludeNested(workspace, join(workspace, 'dev', 'site'))).toBe(true);
    const lines = readFileSync(join(workspace, '.git', 'info', 'exclude'), 'utf8').split('\n');
    expect(lines.filter((line) => line === '/dev/site/').length).toBe(1);
  });

  it('refuses a folder outside the workspace', async () => {
    const outcome = await runWorkspaceJob(
      root,
      { op: 'git_clone', url: 'https://example.com/x.git', folder: '../elsewhere', name: 'x' },
      {},
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({
      status: 'failed',
      error: 'The folder is outside the workspace',
    });
  });
});

describe('ssh through the egress', () => {
  it("pins GitHub's published host keys", () => {
    const file = join(root, 'pinned');
    writeFileSync(file, `${PINNED_KNOWN_HOSTS.join('\n')}\n`);
    const fingerprints = execFileSync('ssh-keygen', ['-lf', file]).toString();
    // The fingerprints GitHub publishes (docs, api.github.com/meta).
    expect(fingerprints).toContain('SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU');
    expect(fingerprints).toContain('SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM');
    expect(fingerprints).toContain('SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s');
    expect(fingerprints.trim().split('\n')).toHaveLength(3);
  });

  it('sends GitHub to its SSH port on 443, and every host through the proxy command', () => {
    const config = sshConfig('/profiles/vol/helena-ssh');
    expect(config).toContain('Host github.com\n  HostName ssh.github.com\n  Port 443\n');
    expect(config).toContain('HostKeyAlias github.com');
    expect(config).toContain(
      "ProxyCommand python3 -I '/profiles/vol/helena-ssh/proxy-connect.py' %h %p",
    );
    // ssh itself accepts it.
    const dir = join(root, 'cfg');
    mkdirSync(dir);
    writeFileSync(join(dir, 'ssh_config'), sshConfig(dir));
    const parsed = execFileSync('ssh', ['-G', '-F', join(dir, 'ssh_config'), 'github.com'])
      .toString()
      .toLowerCase();
    expect(parsed).toContain('hostname ssh.github.com');
    expect(parsed).toContain('port 443');
  });

  it('a clone learns no host key: strict, with a known_hosts of its own that goes with it', async () => {
    const dir = join(root, 'keys');
    await applySshKeys(dir, [{ id: 42, label: 'Deploy', updatedAt: 'a', privateKey: KEY(42) }]);
    const ssh = await cloneSshEnv(dir);
    const command = ssh.env.GIT_SSH_COMMAND!;
    expect(command).toContain('-o StrictHostKeyChecking=yes');
    expect(command).toContain(`-i '${join(dir, 'id_42')}'`);
    const scratch = /UserKnownHostsFile='([^']+)\/known_hosts'/.exec(command)![1]!;
    expect(scratch.startsWith(dir)).toBe(false);
    expect(statSync(scratch).isDirectory()).toBe(true);
    await ssh.cleanup();
    expect(() => statSync(scratch)).toThrow();
    // The job's own key alone, where the owner picked one: GitHub would take another
    // repository's deploy key first and refuse this repository.
    await applySshKeys(dir, [
      { id: 42, label: 'Deploy', updatedAt: 'a', privateKey: KEY(42) },
      { id: 7, label: 'Other repo', updatedAt: 'a', privateKey: KEY(7) },
    ]);
    const picked = await cloneSshEnv(dir, 42);
    expect(picked.env.GIT_SSH_COMMAND).toContain(`-i '${join(dir, 'id_42')}'`);
    expect(picked.env.GIT_SSH_COMMAND).not.toContain('id_7');
    await picked.cleanup();
    // No keys: git runs without Helena's ssh.
    expect((await cloneSshEnv(join(root, 'empty'))).env).toEqual({});
    expect((await cloneSshEnv(null)).env).toEqual({});
  });

  it('the proxy command tunnels through an HTTP CONNECT proxy, or goes straight', async () => {
    const { createServer, connect } = await import('node:net');
    const { spawn } = await import('node:child_process');
    // Both keep the other direction open after one side is done sending (a half-close),
    // as the egress proxy does.
    const echo = createServer({ allowHalfOpen: true }, (socket) => socket.pipe(socket));
    await new Promise<void>((done) => echo.listen(0, '127.0.0.1', done));
    const echoPort = (echo.address() as { port: number }).port;
    const connects: string[] = [];
    const proxy = createServer({ allowHalfOpen: true }, (client) => {
      client.once('data', (head: Buffer) => {
        const line = head.toString('latin1').split('\r\n')[0]!;
        connects.push(line);
        const [host, port] = line.split(' ')[1]!.split(':');
        const upstream = connect({ port: Number(port), host, allowHalfOpen: true }, () => {
          client.write('HTTP/1.1 200 Connection established\r\n\r\n');
          client.pipe(upstream).pipe(client);
        });
      });
    });
    await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
    const proxyPort = (proxy.address() as { port: number }).port;
    const dir = join(root, 'proxy');
    await applySshKeys(dir, [{ id: 1, label: 'k', updatedAt: 'a', privateKey: KEY(1) }]);
    const through = (env: Record<string, string>) =>
      new Promise<string>((done, fail) => {
        const child = spawn(
          'python3',
          ['-I', join(dir, 'proxy-connect.py'), '127.0.0.1', String(echoPort)],
          { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env } },
        );
        let out = '';
        child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
        child.on('error', fail);
        child.on('close', () => done(out));
        child.stdin.end('hello through\n');
      });
    try {
      expect(await through({ https_proxy: `http://127.0.0.1:${proxyPort}` })).toBe(
        'hello through\n',
      );
      expect(connects).toEqual([`CONNECT 127.0.0.1:${echoPort} HTTP/1.1`]);
      expect(await through({})).toBe('hello through\n');
      expect(connects).toHaveLength(1);
    } finally {
      echo.close();
      proxy.close();
    }
  });
});

describe('where a clone lands', () => {
  const job = {
    op: 'git_clone' as const,
    url: 'git@github.com:wilhelmpa/homepage.git',
    folder: 'homepage',
    name: 'homepage',
    slug: 'vol',
    workspace: '/srv/volition/workspaces/projects/vol',
  };

  it("reads the project's slug and workspace from the job", () => {
    expect(parseWorkspaceJob(JSON.stringify(job))).toEqual(job);
    expect(parseWorkspaceJob(JSON.stringify({ ...job, credentialId: 42 })).credentialId).toBe(42);
    expect(() => parseWorkspaceJob(JSON.stringify({ ...job, credentialId: '42' }))).toThrow();
    expect(() => parseWorkspaceJob(JSON.stringify({ ...job, slug: '../x' }))).toThrow();
    expect(() => parseWorkspaceJob(JSON.stringify({ ...job, workspace: 'relative' }))).toThrow();
  });

  it("an isolated runner clones only into its own project's workspace", () => {
    const vol = {
      cwd: '/srv/volition/workspaces/projects/vol',
      isolation: { slug: 'vol', profile: 'vol', agentId: 5 },
    };
    expect(jobWorkspace(vol, job, true)).toBe('/srv/volition/workspaces/projects/vol');
    // The Home agent's runner (runs 90/91 on 2026-09-25) is refused rather than cloning
    // into Home's workspace.
    const home = {
      cwd: '/srv/volition/workspaces/home',
      isolation: { slug: 'home', profile: 'home', agentId: null },
    };
    expect(() => jobWorkspace(home, job, true)).toThrow(/works in home; the clone belongs to vol/);
  });

  it("an unisolated runner resolves the folder against the project's workspace, not its own directory", () => {
    const inside = { cwd: '/srv/volition/workspaces/projects/vol/homepage' };
    expect(jobWorkspace(inside, job, false)).toBe('/srv/volition/workspaces/projects/vol');
    const above = { cwd: '/srv/volition/workspaces' };
    expect(jobWorkspace(above, job, false)).toBe('/srv/volition/workspaces/projects/vol');
    const elsewhere = { cwd: '/srv/volition/workspaces/home' };
    expect(() => jobWorkspace(elsewhere, job, false)).toThrow();
    // A job from an older server names no workspace: the runner's own directory.
    const old = { op: 'git_clone' as const, url: 'x', folder: 'a', name: 'b' };
    expect(jobWorkspace(elsewhere, old, false)).toBe('/srv/volition/workspaces/home');
  });

  it("clones into the job's workspace and removes a half-made target after a failure", async () => {
    const workspace = join(root, 'projects', 'vol');
    mkdirSync(workspace, { recursive: true });
    const source = join(root, 'source.git');
    execFileSync('git', ['init', '-q', '--bare', source]);
    const cwd = join(workspace, 'somewhere');
    mkdirSync(cwd);
    const cloned = await runWorkspaceJobLocally(
      { cwd, env: {} },
      { op: 'git_clone', url: source, folder: 'dev', name: 'repo', slug: 'vol', workspace },
      null,
      new AbortController().signal,
    );
    expect(cloned.status).toBe('success');
    expect(statSync(join(workspace, 'dev', 'repo', '.git')).isDirectory()).toBe(true);
    const failed = await runWorkspaceJobLocally(
      { cwd, env: {} },
      {
        op: 'git_clone',
        url: join(root, 'missing.git'),
        folder: 'dev',
        name: 'other',
        slug: 'vol',
        workspace,
      },
      null,
      new AbortController().signal,
    );
    expect(failed).toMatchObject({ status: 'failed', error: 'git clone failed' });
    expect(() => statSync(join(workspace, 'dev', 'other'))).toThrow();
  });
});
