import { spawn } from 'node:child_process';
import { appendFile, lstat, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { RunnerConfig } from './config';
import type { Outcome } from './execute';
import { gitSshCommand, sshKeyFiles, writeSshSupport } from './ssh';

// A run whose trigger is 'workspace' is a job Helena gives the runner rather than a task
// for the model: today "clone a repository into an area folder". The runner holds the
// project workspace and the SSH keys of the run, so it does the clone itself, with git,
// and tells the workspace repository to ignore the new nested repository. With agent
// isolation the clone runs in the project's own unit, as the project's user (the profile
// helper's `workspace-job`), so the files belong to the project like everything else in
// its workspace, and the network is the project's egress.

export interface CloneJob {
  op: 'git_clone';
  url: string;
  // The area folder below the workspace, '' for the workspace itself.
  folder: string;
  // The directory the repository is cloned into, inside the folder.
  name: string;
  // The project's slug and its workspace, as Helena knows them. The folder is resolved
  // against that workspace, never against the runner's own working directory (a Home
  // agent's runner once cloned into Home's workspace, 2026-09-25). Absent from an older
  // server, which leaves the runner's working directory.
  slug?: string;
  workspace?: string;
}

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;

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
  if (value.slug !== undefined && (typeof value.slug !== 'string' || !SLUG.test(value.slug))) {
    throw new Error('The project of the job is not valid');
  }
  if (
    value.workspace !== undefined &&
    (typeof value.workspace !== 'string' || !isAbsolute(value.workspace))
  ) {
    throw new Error('The workspace of the job is not valid');
  }
  return {
    op: 'git_clone',
    url: value.url,
    folder: value.folder,
    name: value.name,
    ...(value.slug !== undefined && { slug: value.slug }),
    ...(value.workspace !== undefined && { workspace: resolve(value.workspace) }),
  };
}

function inside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

function withinOrSame(base: string, candidate: string): boolean {
  return resolve(base) === resolve(candidate) || inside(base, candidate);
}

// The workspace the job's folder is resolved against. A job that names its project's
// workspace is done only by a runner working in that project: an isolated one whose
// project is the job's, an unisolated one whose working directory is inside that workspace
// or holds it (the layout from before isolation, where Home worked above every project).
export function jobWorkspace(
  config: Pick<RunnerConfig, 'cwd' | 'isolation'>,
  job: CloneJob,
  isolated: boolean,
): string {
  const own = resolve(config.cwd ?? process.cwd());
  if (!job.workspace) return own;
  if (isolated) {
    const slug = config.isolation?.slug;
    if (job.slug && slug !== job.slug) {
      throw new Error(
        `This agent works in ${slug ?? 'no project'}; the clone belongs to ${job.slug}. ` +
          "Start it with one of that project's agents.",
      );
    }
    return job.workspace;
  }
  if (withinOrSame(job.workspace, own) || inside(own, job.workspace)) return job.workspace;
  throw new Error(`This agent's working directory is not in ${job.workspace}`);
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

// The ssh command of a clone: the keys of the agent's key directory, the pinned host keys
// only (a host key that is not pinned is refused, never learnt), and a known_hosts of the
// job's own in a directory private to it, which is removed with it.
export async function cloneSshEnv(
  sshDir: string | null,
): Promise<{ env: Record<string, string>; cleanup: () => Promise<void> }> {
  if (!sshDir) return { env: {}, cleanup: async () => {} };
  const keys = await sshKeyFiles(sshDir);
  if (keys.length === 0) return { env: {}, cleanup: async () => {} };
  await writeSshSupport(sshDir);
  const scratch = await mkdtemp(join(tmpdir(), 'helena-clone-'));
  return {
    env: {
      GIT_SSH_COMMAND: gitSshCommand(sshDir, keys, {
        strict: true,
        knownHosts: join(scratch, 'known_hosts'),
      }),
    },
    cleanup: () => rm(scratch, { recursive: true, force: true }),
  };
}

// Clones into `base` (the project's workspace). `env` is the whole environment git runs
// with.
export async function runWorkspaceJob(
  base: string,
  job: CloneJob,
  env: Record<string, string>,
  signal: AbortSignal,
): Promise<Outcome> {
  const parent = job.folder ? resolve(base, job.folder) : base;
  if (job.folder && (isAbsolute(job.folder) || !inside(base, parent))) {
    return { status: 'failed', output: '', error: 'The folder is outside the workspace' };
  }
  await mkdir(parent, { recursive: true });
  const target = join(parent, job.name);
  if (await exists(target)) {
    return { status: 'failed', output: '', error: `${relative(base, target)} exists already` };
  }
  const result = await git(['clone', '--', job.url, target], { cwd: parent, env, signal });
  if (result.code !== 0) {
    // git leaves a half-made target behind when the clone fails early; the next try would
    // find it "exists already".
    await rm(target, { recursive: true, force: true }).catch(() => {});
    return { status: 'failed', output: result.output, error: 'git clone failed' };
  }
  const excluded = await excludeNested(base, target);
  const where = relative(base, target);
  return {
    status: 'success',
    output: `Cloned ${job.url} into ${where}.${excluded ? ' The workspace repository ignores it.' : ''}\n${result.output}`,
  };
}

// The whole job where the runner itself does it (an agent that is not isolated): the
// workspace checked, the strict ssh of the clone, and the scratch directory removed.
export async function runWorkspaceJobLocally(
  config: Pick<RunnerConfig, 'cwd' | 'isolation' | 'env'>,
  job: CloneJob,
  sshDir: string | null,
  signal: AbortSignal,
): Promise<Outcome> {
  let base: string;
  try {
    base = jobWorkspace(config, job, false);
  } catch (error) {
    return { status: 'failed', output: '', error: (error as Error).message };
  }
  const ssh = await cloneSshEnv(sshDir);
  try {
    return await runWorkspaceJob(
      base,
      job,
      { ...(process.env as Record<string, string>), ...config.env, ...ssh.env },
      signal,
    );
  } finally {
    await ssh.cleanup();
  }
}
