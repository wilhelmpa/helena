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
import { applySshKeys, gitSshCommand, sshDir } from '../ssh';
import { excludeNested, parseWorkspaceJob, runWorkspaceJob } from '../workspace-job';

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
    expect(env.GIT_SSH_COMMAND).toContain('-F /dev/null');
    expect(env.GIT_SSH_COMMAND).not.toContain('key-7');

    // A revoked key is gone before the next command; the host keys learnt stay.
    writeFileSync(join(dir, 'known_hosts'), 'github.com ssh-ed25519 AAAA\n');
    const after = await applySshKeys(dir, [
      { id: 9, label: 'Gitea', updatedAt: 'b', privateKey: KEY(90) },
    ]);
    expect(readdirSync(dir).sort()).toEqual(['id_9', 'known_hosts']);
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
      { cwd: workspace, env: {} },
      { op: 'git_clone', url: source, folder: 'dev', name: 'site' },
      {},
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
      { cwd: workspace, env: {} },
      { op: 'git_clone', url: source, folder: 'dev', name: 'site' },
      {},
      new AbortController().signal,
    );
    expect(again).toMatchObject({ status: 'failed', error: 'dev/site exists already' });
    expect(await excludeNested(workspace, join(workspace, 'dev', 'site'))).toBe(true);
    const lines = readFileSync(join(workspace, '.git', 'info', 'exclude'), 'utf8').split('\n');
    expect(lines.filter((line) => line === '/dev/site/').length).toBe(1);
  });

  it('refuses a folder outside the workspace', async () => {
    const outcome = await runWorkspaceJob(
      { cwd: root, env: {} },
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
