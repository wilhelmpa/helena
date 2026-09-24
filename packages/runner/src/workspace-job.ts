import { spawn } from 'node:child_process';
import { appendFile, lstat, mkdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { RunnerConfig } from './config';
import type { Outcome } from './execute';

// A run whose trigger is 'workspace' is a job Helena gives the runner rather than a task
// for the model: today "clone a repository into an area folder". The runner holds the
// project workspace and the SSH keys of the run, so it does the clone itself, with git,
// and tells the workspace repository to ignore the new nested repository.

export interface CloneJob {
  op: 'git_clone';
  url: string;
  // The area folder below the workspace, '' for the workspace itself.
  folder: string;
  // The directory the repository is cloned into, inside the folder.
  name: string;
}

const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function parseWorkspaceJob(prompt: string): CloneJob {
  let job: unknown;
  try {
    job = JSON.parse(prompt);
  } catch {
    throw new Error('The workspace job cannot be read');
  }
  const value = job as Partial<CloneJob>;
  if (
    value?.op !== 'git_clone' ||
    typeof value.url !== 'string' ||
    typeof value.folder !== 'string'
  ) {
    throw new Error('Unknown workspace job');
  }
  if (typeof value.name !== 'string' || !NAME.test(value.name) || value.name.startsWith('.')) {
    throw new Error('The target folder name is not allowed');
  }
  if (value.url.startsWith('-')) throw new Error('The repository address is not allowed');
  return { op: 'git_clone', url: value.url, folder: value.folder, name: value.name };
}

function inside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

function git(
  args: string[],
  options: { cwd: string; env: Record<string, string>; signal: AbortSignal },
): Promise<{ code: number | null; output: string }> {
  return new Promise((done) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: { ...options.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    });
    let output = '';
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (error) => done({ code: -1, output: `${output}\n${error.message}` }));
    child.on('close', (code) => done({ code, output }));
  });
}

// Adds the nested repository to the workspace repository's own ignore file
// (.git/info/exclude), so the workspace does not track another repository's files.
export async function excludeNested(workspace: string, path: string): Promise<boolean> {
  const exclude = join(workspace, '.git', 'info', 'exclude');
  const gitDir = join(workspace, '.git');
  const gitStat = await stat(gitDir).catch(() => null);
  if (!gitStat?.isDirectory()) return false;
  await mkdir(join(gitDir, 'info'), { recursive: true });
  const line = `/${relative(workspace, path).split(sep).join('/')}/`;
  const current = await readFile(exclude, 'utf8').catch(() => '');
  if (current.split('\n').includes(line)) return true;
  await appendFile(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
  return true;
}

export async function runWorkspaceJob(
  config: Pick<RunnerConfig, 'cwd' | 'env'>,
  job: CloneJob,
  env: Record<string, string>,
  signal: AbortSignal,
): Promise<Outcome> {
  const base = resolve(config.cwd ?? process.cwd());
  const parent = job.folder ? resolve(base, job.folder) : base;
  if (job.folder && (isAbsolute(job.folder) || !inside(base, parent))) {
    return { status: 'failed', output: '', error: 'The folder is outside the workspace' };
  }
  await mkdir(parent, { recursive: true });
  const target = join(parent, job.name);
  if (await exists(target)) {
    return { status: 'failed', output: '', error: `${relative(base, target)} exists already` };
  }
  const result = await git(['clone', '--', job.url, target], {
    cwd: parent,
    env: { ...(process.env as Record<string, string>), ...config.env, ...env },
    signal,
  });
  if (result.code !== 0) {
    return { status: 'failed', output: result.output, error: 'git clone failed' };
  }
  const excluded = await excludeNested(base, target);
  const where = relative(base, target);
  return {
    status: 'success',
    output: `Cloned ${job.url} into ${where}.${excluded ? ' The workspace repository ignores it.' : ''}\n${result.output}`,
  };
}
