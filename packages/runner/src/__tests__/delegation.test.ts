import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { delegationWorktree, reviewCommitMatches } from '../delegation';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('delegated work stays in an isolated worktree and returns an uncommitted diff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'volition-delegation-'));
  try {
    git(root, 'init', '-q');
    await writeFile(join(root, 'file.txt'), 'before\n');
    git(root, 'add', 'file.txt');
    git(
      root,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'base',
    );
    const base = git(root, 'rev-parse', 'HEAD');
    const worktree = await delegationWorktree(root, 12);
    expect(git(root, 'status', '--porcelain')).toBe('');
    await writeFile(join(worktree.path, 'file.txt'), 'after\n');
    await writeFile(join(worktree.path, 'new.txt'), 'new\n');
    const result = await worktree.result('Implemented', 80);
    expect(result).toMatchObject({
      status: 'success',
      touchedFiles: ['file.txt', 'new.txt'],
      finalMessage: 'Implemented',
    });
    expect(result.diff).toContain('+after');
    expect(result.diff).toContain('new.txt');
    expect(git(root, 'rev-parse', 'HEAD')).toBe(base);
    expect(await await Bun.file(join(root, 'file.txt')).text()).toBe('before\n');
    await worktree.remove();
    expect(git(root, 'worktree', 'list')).not.toContain('run-12');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a delegated commit is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'volition-delegation-'));
  try {
    git(root, 'init', '-q');
    await writeFile(join(root, 'file.txt'), 'before\n');
    git(root, 'add', 'file.txt');
    git(
      root,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'base',
    );
    const worktree = await delegationWorktree(root, 13);
    await writeFile(join(worktree.path, 'file.txt'), 'after\n');
    git(worktree.path, 'add', 'file.txt');
    git(
      worktree.path,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'not allowed',
    );
    await expect(worktree.result('Done', 90)).rejects.toThrow('committed');
    const resumed = await delegationWorktree(root, 13);
    await expect(resumed.result('Done', 90)).rejects.toThrow('committed');
    await worktree.remove();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review reports only an actual new commit', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  expect(reviewCommitMatches(base, head, JSON.stringify({ commit: head }))).toBe(true);
  expect(reviewCommitMatches(base, base, JSON.stringify({ commit: base }))).toBe(false);
  expect(reviewCommitMatches(base, head, JSON.stringify({ commit: base }))).toBe(false);
  expect(reviewCommitMatches(base, head, 'not JSON')).toBe(false);
});
