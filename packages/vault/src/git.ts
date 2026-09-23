import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { isTextFile } from './mime';
import { isSyncConflict, isWithin, PRIVATE_DIR, vaultRoot } from './paths';
import { runProgram, type ProgramResult } from './process';

// The vault is one git repository that tracks text files only; Private/ is a second
// repository inside it, so its history is readable by the private group alone. Both
// are created by the setup script (deployment/volition-stack/native/vault-setup.sh). A
// vault without a repository (a test run, a development machine) is not versioned.

export interface GitAuthor {
  name: string;
  email: string;
}

export const EXTERNAL_AUTHOR: GitAuthor = { name: 'extern', email: 'extern@volition.local' };

export const PLAN_AUTHOR: GitAuthor = { name: 'Volition Plan', email: 'plan@volition.local' };

const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 100;

interface Repository {
  dir: string;
  // The paths of the vault this repository holds, relative to `dir`.
  paths: string[];
}

function repositories(relativePaths: string[]): Repository[] {
  const root = vaultRoot();
  const main: string[] = [];
  const secret: string[] = [];
  for (const relative of relativePaths) {
    if (isWithin(relative, PRIVATE_DIR)) {
      const inner = relative.slice(PRIVATE_DIR.length + 1);
      if (inner) secret.push(inner);
    } else if (relative) {
      main.push(relative);
    }
  }
  return [
    { dir: root, paths: main },
    { dir: path.join(root, PRIVATE_DIR), paths: secret },
  ].filter((repository) => repository.paths.length > 0);
}

export function isRepository(dir: string): boolean {
  return existsSync(path.join(dir, '.git'));
}

// Commits from the API and the worker's watcher can run at the same moment; each waits
// for the other's index lock instead of failing.
async function git(dir: string, args: string[]): Promise<ProgramResult> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await runProgram(
      [
        'git',
        '--literal-pathspecs',
        // The vault root belongs to root and its folders to the services that made them,
        // which git otherwise refuses as a repository of another user.
        '-c',
        `safe.directory=${dir}`,
        '-c',
        `user.name=${PLAN_AUTHOR.name}`,
        '-c',
        `user.email=${PLAN_AUTHOR.email}`,
        '-C',
        dir,
        ...args,
      ],
      { timeoutMs: 60_000 },
    );
    if (result.code === 0 || !result.stderr.includes('index.lock') || attempt >= LOCK_RETRIES) {
      return result;
    }
    await Bun.sleep(LOCK_RETRY_MS);
  }
}

async function gitOrThrow(dir: string, args: string[]): Promise<ProgramResult> {
  const result = await git(dir, args);
  if (result.code !== 0) {
    throw new Error(`git ${args[0]} failed in ${dir}: ${result.stderr.trim() || result.code}`);
  }
  return result;
}

// Whether the history tracks a path of a repository: text files, not in the trash, not
// Obsidian's window layout. The .gitignore vault-setup.sh writes says the same, so
// `git status` stays clean for a person looking at the repository.
export function isVersioned(relative: string): boolean {
  const parts = relative.split('/');
  return (
    isTextFile(relative) &&
    !isSyncConflict(relative) &&
    !parts.some((part) => UNVERSIONED.has(part) || part.endsWith('.tmp')) &&
    !(parts[0] === '.obsidian' && /^(workspace|cache)/.test(parts[1] ?? ''))
  );
}

const UNVERSIONED = new Set(['.git', '.trash', '.stfolder', '.stversions']);

// Only the paths git can take: a folder or a versioned file on disk, and a removed path
// git tracked before, so its removal is recorded.
async function committable(repository: Repository): Promise<string[]> {
  const kept: string[] = [];
  const gone: string[] = [];
  for (const relative of repository.paths) {
    if (relative.split('/').some((part) => part === '.git' || part === '.trash')) continue;
    const stats = statSync(path.join(repository.dir, relative), { throwIfNoEntry: false });
    if (!stats) gone.push(relative);
    else if (stats.isDirectory() || isVersioned(relative)) kept.push(relative);
  }
  if (gone.length === 0) return kept;
  const tracked = await gitOrThrow(repository.dir, ['ls-files', '-z', '--', ...gone]);
  const trackedFiles = tracked.stdout.split('\0').filter(Boolean);
  return [
    ...kept,
    ...gone.filter((relative) => trackedFiles.some((file) => isWithin(file, relative))),
  ];
}

// How long the saves one author makes to the same files go into one commit. The editor
// saves while the owner types; without this every pause would be a version.
const SAVE_SESSION_MS = 10 * 60_000;

// Whether the last commit is one this save continues: the same author, the same files,
// recent enough.
async function continuesHead(dir: string, paths: string[], author: GitAuthor): Promise<boolean> {
  const head = await git(dir, ['log', '-1', '--format=%an%x1f%ae%x1f%ct', '--name-only']);
  if (head.code !== 0) return false;
  const [meta = '', ...files] = head.stdout.split('\n').filter(Boolean);
  const [name, email, seconds] = meta.split('\x1f');
  return (
    name === author.name &&
    email === author.email &&
    Date.now() - Number(seconds) * 1000 < SAVE_SESSION_MS &&
    [...files].sort().join('\n') === [...paths].sort().join('\n')
  );
}

async function commitRepository(
  repository: Repository,
  message: string,
  author: GitAuthor,
  continueSession = false,
): Promise<void> {
  if (!isRepository(repository.dir)) return;
  const paths = await committable(repository);
  if (paths.length === 0) return;
  await gitOrThrow(repository.dir, ['add', '-A', '--', ...paths]);
  const staged = await git(repository.dir, ['diff', '--cached', '--quiet', '--', ...paths]);
  if (staged.code === 0) return;
  const amend = continueSession && (await continuesHead(repository.dir, paths, author));
  await gitOrThrow(repository.dir, [
    'commit',
    '--quiet',
    '--no-verify',
    ...(amend ? ['--amend', '--no-edit'] : ['-m', message]),
    `--author=${author.name} <${author.email}>`,
    '--',
    ...paths,
  ]);
}

// Commits the current state of the given vault paths (files or folders, present or
// removed) as one commit per repository. With `continueSession`, a save that follows the
// same author's save of the same files within ten minutes amends that commit. A failure
// is logged: the files are already written, and the watcher's next commit of outside
// changes picks the paths up.
export async function commitVaultPaths(
  relativePaths: string[],
  message: string,
  author: GitAuthor,
  options: { continueSession?: boolean } = {},
): Promise<void> {
  for (const repository of repositories(relativePaths)) {
    try {
      await commitRepository(repository, message, author, options.continueSession);
    } catch (error) {
      console.error('[vault] git commit failed:', error);
    }
  }
}

// Commits everything that changed in the vault without going through Plan: edits made in
// Obsidian, by an agent's file tools or in an editor. Called by the watcher once the
// vault has been quiet for a moment.
export async function commitExternalChanges(): Promise<void> {
  const root = vaultRoot();
  for (const dir of [root, path.join(root, PRIVATE_DIR)]) {
    if (!isRepository(dir)) continue;
    try {
      const status = await gitOrThrow(dir, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--no-renames',
      ]);
      const paths = status.stdout
        .split('\0')
        .filter(Boolean)
        .map((entry) => entry.slice(3))
        .filter(
          (relative) => isVersioned(relative) && (dir !== root || !isWithin(relative, PRIVATE_DIR)),
        );
      if (paths.length > 0) {
        await commitRepository({ dir, paths }, 'External changes', EXTERNAL_AUTHOR);
      }
    } catch (error) {
      console.error('[vault] git commit of external changes failed:', error);
    }
  }
}

export interface FileRevision {
  commit: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
  message: string;
}

// The commits that changed one file, newest first, following renames.
export async function fileHistory(relative: string, limit = 50): Promise<FileRevision[]> {
  const [repository] = repositories([relative]);
  if (!repository || !isRepository(repository.dir)) return [];
  const result = await git(repository.dir, [
    'log',
    `--max-count=${limit}`,
    '--follow',
    '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e',
    '--',
    repository.paths[0],
  ]);
  if (result.code !== 0) return [];
  return result.stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [commit, authorName, authorEmail, committedAt, message] = record.split('\x1f');
      return { commit, authorName, authorEmail, committedAt, message };
    });
}

// A file's text at one commit of its history, or null when that commit does not hold
// it under this path.
export async function fileAtRevision(relative: string, commit: string): Promise<string | null> {
  if (!/^[0-9a-f]{7,64}$/.test(commit)) return null;
  const [repository] = repositories([relative]);
  if (!repository || !isRepository(repository.dir)) return null;
  const log = await git(repository.dir, [
    'log',
    '--max-count=1',
    '--follow',
    '--name-only',
    '--format=',
    commit,
    '--',
    repository.paths[0],
  ]);
  const pathAtCommit = log.code === 0 ? log.stdout.trim().split('\n')[0] : '';
  if (!pathAtCommit) return null;
  const show = await git(repository.dir, ['show', `${commit}:${pathAtCommit}`]);
  return show.code === 0 ? show.stdout : null;
}
