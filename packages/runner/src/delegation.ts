import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const exec = promisify(execFile);
const DIFF_LIMIT = 100_000;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}

export async function repositoryHead(cwd: string): Promise<string> {
  return (await git(cwd, 'rev-parse', 'HEAD')).trim();
}

export function reviewCommitMatches(base: string, head: string, output: string): boolean {
  try {
    return head !== base && (JSON.parse(output) as { commit?: unknown }).commit === head;
  } catch {
    return false;
  }
}

export interface DelegationResult {
  status: 'success';
  touchedFiles: string[];
  finalMessage: string;
  version: '1';
  durationMs: number;
  diff: string;
}

export async function delegationWorktree(cwd: string, runId: number) {
  const root = (await git(cwd, 'rev-parse', '--show-toplevel')).trim();
  const path = join(root, '.volition-escalations', `run-${runId}`);
  const baseFile = join(root, '.volition-escalations', `run-${runId}.base`);
  const exclude = resolve(
    root,
    (await git(root, 'rev-parse', '--git-path', 'info/exclude')).trim(),
  );
  const excluded = await readFile(exclude, 'utf8').catch(() => '');
  if (!excluded.split('\n').includes('/.volition-escalations/')) {
    await mkdir(dirname(exclude), { recursive: true });
    await appendFile(exclude, '\n/.volition-escalations/\n');
  }
  await mkdir(join(root, '.volition-escalations'), { recursive: true });
  const area = await lstat(join(root, '.volition-escalations'));
  if (!area.isDirectory() || area.isSymbolicLink())
    throw new Error('Delegation worktree directory is not a real directory');
  if ((await lstat(baseFile).catch(() => null))?.isSymbolicLink())
    throw new Error('Delegation base file cannot be a symlink');
  if (!(await stat(path).catch(() => null))) {
    const base =
      (await readFile(baseFile, 'utf8').catch(() => null))?.trim() ??
      (await git(root, 'rev-parse', 'HEAD')).trim();
    if (!(await stat(baseFile).catch(() => null))) await writeFile(baseFile, base, { flag: 'wx' });
    await git(root, 'worktree', 'add', '--detach', '--', path, base);
  } else {
    const actual = (await git(path, 'rev-parse', '--show-toplevel')).trim();
    if (actual !== path) throw new Error('Delegation worktree path is occupied');
  }
  const base = (await readFile(baseFile, 'utf8')).trim();
  return {
    path,
    async result(finalMessage: string, durationMs: number): Promise<DelegationResult> {
      if ((await git(path, 'rev-parse', 'HEAD')).trim() !== base)
        throw new Error('The implementer committed; only an uncommitted diff is accepted');
      await git(path, 'add', '-N', '--', '.');
      const diff = await git(path, 'diff', '--binary', 'HEAD');
      if (!diff.trim()) throw new Error('The implementer returned no diff');
      if (Buffer.byteLength(diff, 'utf8') > DIFF_LIMIT)
        throw new Error('The delegated diff exceeds 100 KiB');
      const touchedFiles = (await git(path, 'diff', '--name-only', '-z', 'HEAD'))
        .split('\0')
        .filter(Boolean);
      if (touchedFiles.length > 500 || touchedFiles.some((file) => file.length > 512))
        throw new Error('The delegated result contains too many or oversized file paths');
      return { status: 'success', touchedFiles, finalMessage, version: '1', durationMs, diff };
    },
    async remove() {
      await git(root, 'worktree', 'remove', '--force', '--', path);
      await rm(baseFile, { force: true });
    },
  };
}
