import { StringDecoder } from 'node:string_decoder';
import { createConnection } from 'node:net';

// With AGENT_ISOLATION=on the runner starts nothing itself. Every run, chat answer and
// profile operation goes to the launcher (deployment/volition-stack/isolation/launcher.py),
// which starts it as the project's own Unix user in a sandbox: its own network namespace,
// only its workspace, its profile and its vault folder, the internet only through the egress
// proxy. The runner names the project, the runtime, the profile and the working directory;
// the launcher checks each and decides everything else.

export const DEFAULT_LAUNCHER_SOCKET = '/run/volition-agent-launcher/launch.sock';

export function isolationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENT_ISOLATION === 'on';
}

export function launcherSocket(env: NodeJS.ProcessEnv = process.env): string {
  return env.VOLITION_LAUNCHER_SOCKET?.trim() || DEFAULT_LAUNCHER_SOCKET;
}

// Where an agent of the runner config runs when it is isolated: its project and its profile.
export interface AgentIsolation {
  slug: string;
  profile: string;
  agentId: number | null;
  // The agent's own runtime (config `agent`). The launcher gives the
  // profile helper of a Claude Code or Codex agent no Hermes login views, which would cover
  // the agent's own login in its profile (.codex is a Codex agent's CODEX_HOME).
  runtime?: string;
}

export type WorkKind = 'run' | 'chat' | 'helper' | 'background';

export interface LaunchRequest {
  slug: string;
  profile: string | null;
  runtime: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  agentId: number | null;
  work: { kind: WorkKind; id: number | null };
  limits?: { runtimeMaxSec?: number };
  agentRuntime?: string;
}

export interface LaunchIo {
  stdin?: string;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  // Aborting closes the connection, which is how the launcher is told to stop the unit.
  signal?: AbortSignal;
}

export interface LaunchResult {
  code: number | null;
  unit: string | null;
}

export class LaunchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Frame kinds, as launcher.py names them.
const T_STDIN = 0x01;
const T_EOF = 0x02;
const T_ACCEPT = 0x10;
const T_STDOUT = 0x11;
const T_STDERR = 0x12;
const T_EXIT = 0x13;
const T_ERROR = 0x14;
const T_RESULT = 0x15;
const MAX_FRAME = 1024 * 1024;

function frame(kind: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt8(kind, 0);
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

// Variables the launcher sets itself and refuses from a caller. The runner's config carries
// some of them for an agent that runs unisolated; here they are left out.
const RESERVED = new Set([
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'HERMES_HOME',
  'HERMES_HOME_MODE',
  'HERMES_SHARED_AUTH_DIR',
  'PYTHONPATH',
  'PYTHONHOME',
  'NO_PROXY',
  'NODE_USE_ENV_PROXY',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'CREDENTIALS_DIRECTORY',
  'NOTIFY_SOCKET',
  // The project browser is reached through the browser gateway, never over CDP.
  'BROWSER_CDP_URL',
  'DISPLAY',
  'XAUTHORITY',
]);
const PROXY = new Set(['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'ftp_proxy']);
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

// The variables an isolated command gets: the ones meant for it, never the runner's own
// environment and never one the launcher decides.
export function isolatedEnv(...sources: Record<string, string>[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      if (!NAME.test(name) || typeof value !== 'string') continue;
      if (RESERVED.has(name) || PROXY.has(name.toLowerCase())) continue;
      if (name.startsWith('VOLITION_AGENT_') || name.startsWith('SYSTEMD_')) continue;
      env[name] = value;
    }
  }
  return env;
}

// Starts one unit through the launcher and streams its input and output. Resolves with the
// command's exit code; rejects when the launcher refuses the request or goes away.
export function launch(
  request: LaunchRequest,
  io: LaunchIo = {},
  socketPath = launcherSocket(),
): Promise<LaunchResult> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let buffered = Buffer.alloc(0);
    let unit: string | null = null;
    let settled = false;
    const finish = (error: Error | null, result?: LaunchResult) => {
      if (settled) return;
      settled = true;
      io.signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new LaunchError('aborted', 'The run was stopped'));
    if (io.signal?.aborted) return abort();
    io.signal?.addEventListener('abort', abort, { once: true });

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ v: 1, op: 'run', ...request })}\n`);
    });
    socket.on('error', (error) =>
      finish(new LaunchError('launcher', `The agent launcher is not reachable: ${error.message}`)),
    );
    socket.on('close', () =>
      finish(new LaunchError('launcher', 'The agent launcher closed the connection')),
    );
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 5) {
        const kind = buffered.readUInt8(0);
        const length = buffered.readUInt32BE(1);
        if (length > MAX_FRAME)
          return finish(new LaunchError('frame', 'The launcher sent too much'));
        if (buffered.length < 5 + length) break;
        const payload = buffered.subarray(5, 5 + length);
        buffered = buffered.subarray(5 + length);
        if (kind === T_ACCEPT) {
          unit = (JSON.parse(payload.toString('utf8')) as { unit?: string }).unit ?? null;
          const input = Buffer.from(io.stdin ?? '', 'utf8');
          for (let offset = 0; offset < input.length; offset += MAX_FRAME) {
            socket.write(frame(T_STDIN, input.subarray(offset, offset + MAX_FRAME)));
          }
          socket.write(frame(T_EOF, Buffer.alloc(0)));
        } else if (kind === T_STDOUT) {
          io.onStdout?.(Buffer.from(payload));
        } else if (kind === T_STDERR) {
          io.onStderr?.(Buffer.from(payload));
        } else if (kind === T_EXIT) {
          const exit = JSON.parse(payload.toString('utf8')) as { code?: number | null };
          return finish(null, { code: exit.code ?? null, unit });
        } else if (kind === T_ERROR || kind === T_RESULT) {
          const answer = JSON.parse(payload.toString('utf8')) as {
            error?: string;
            message?: string;
          };
          return finish(
            new LaunchError(answer.error ?? 'launcher', answer.message ?? 'The launcher refused'),
          );
        }
      }
    });
  });
}

export interface HelperOptions {
  // How long the operation may run; five minutes by default (a clone takes longer).
  runtimeMaxSec?: number;
  socketPath?: string;
}

// Runs one operation of the runner's own profile helper (cli.ts `profile-helper`) as the
// project user, in the agent's profile, and returns what it answers.
export async function profileHelper<T>(
  isolation: AgentIsolation,
  cwd: string,
  operation: Record<string, unknown>,
  options: HelperOptions | string = {},
): Promise<T> {
  const { runtimeMaxSec = 300, socketPath = launcherSocket() } =
    typeof options === 'string' ? { socketPath: options } : options;
  let stdout = '';
  let stderr = '';
  const attempt = async (agentRuntime: string | undefined) => {
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    stdout = '';
    stderr = '';
    const result = await launch(
      {
        slug: isolation.slug,
        profile: isolation.profile,
        runtime: 'profile-helper',
        args: [],
        env: {},
        cwd,
        agentId: isolation.agentId,
        work: { kind: 'helper', id: null },
        limits: { runtimeMaxSec },
        ...(agentRuntime ? { agentRuntime } : {}),
      },
      {
        stdin: JSON.stringify(operation),
        onStdout: (chunk) => {
          if (stdout.length < 16 * 1024 * 1024) stdout += outDecoder.write(chunk);
        },
        onStderr: (chunk) => {
          stderr = `${stderr}${errDecoder.write(chunk)}`.slice(-2000);
        },
      },
      socketPath,
    );
    stdout += outDecoder.end();
    stderr = `${stderr}${errDecoder.end()}`.slice(-2000);
    return result;
  };
  let result: LaunchResult;
  try {
    result = await attempt(isolation.runtime);
  } catch (error) {
    // A launcher from before agentRuntime refuses the field; the helper then runs as it did.
    if (!(
      error instanceof LaunchError &&
      error.code === 'request' &&
      error.message.includes('agentRuntime')
    )) {
      throw error;
    }
    result = await attempt(undefined);
  }
  const line = stdout.trim().split('\n').pop() ?? '';
  let answer: { ok?: boolean; result?: T; error?: string };
  try {
    answer = JSON.parse(line) as typeof answer;
  } catch {
    throw new Error(
      `The profile helper answered nothing readable (exit ${result.code}): ${stderr.trim().slice(-300)}`,
    );
  }
  if (!answer.ok) throw new Error(answer.error ?? 'The profile helper failed');
  return answer.result as T;
}
