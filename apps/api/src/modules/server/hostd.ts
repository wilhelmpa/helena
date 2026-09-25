import { createConnection } from 'node:net';

// The client of helena-hostd, the root helper for the machine Helena runs on
// (deployment/volition-stack/native/server). It speaks Varlink — JSON messages ended by a
// NUL byte over a Unix socket, systemd's own IPC — so `varlinkctl` on the console calls the
// same methods. The API never runs a privileged command itself: it names an operation of
// the helper's fixed list, and the helper checks the parameters and that the caller is the
// API's own user.

export const DEFAULT_HOSTD_SOCKET = '/run/helena-hostd/hostd.sock';
const INTERFACE = 'io.helena.hostd';
const MAX_REPLY = 16 * 1024 * 1024;

export class HostdError extends Error {
  constructor(
    // The helper's error (`InvalidParameter`, `NotFound`, `Busy`, …), or `Unavailable` when
    // there is no helper to ask, `Timeout` when it did not answer.
    readonly code: string,
    message: string,
    readonly parameter?: string,
  ) {
    super(message);
    this.name = 'HostdError';
  }
}

export type HostdTransport = (
  method: string,
  parameters: Record<string, unknown>,
  timeoutMs: number,
) => Promise<unknown>;

export function hostdSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.HELENA_HOSTD_SOCKET?.trim() || DEFAULT_HOSTD_SOCKET;
}

const UNAVAILABLE_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'EACCES', 'ENOTDIR', 'EPERM']);

export const varlinkTransport: HostdTransport = (method, parameters, timeoutMs) =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ path: hostdSocketPath() });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new HostdError('Timeout', 'The host helper did not answer in time')),
      timeoutMs,
    );
    socket.on('connect', () => {
      socket.write(JSON.stringify({ method: `${INTERFACE}.${method}`, parameters }) + '\0');
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_REPLY) {
        finish(new HostdError('Internal', 'The host helper answered too much'));
        return;
      }
      const end = buffer.indexOf(0);
      if (end < 0) return;
      let reply: { parameters?: Record<string, unknown>; error?: string };
      try {
        reply = JSON.parse(buffer.subarray(0, end).toString('utf8')) as typeof reply;
      } catch {
        finish(new HostdError('Internal', 'The host helper answered something unexpected'));
        return;
      }
      if (reply.error) {
        const params = reply.parameters ?? {};
        const code = reply.error.split('.').pop() ?? 'Internal';
        finish(
          new HostdError(
            code === 'PermissionDenied' ? 'Unavailable' : code,
            typeof params.message === 'string' ? params.message : reply.error,
            typeof params.parameter === 'string' ? params.parameter : undefined,
          ),
        );
        return;
      }
      finish(null, reply.parameters?.result);
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        UNAVAILABLE_CODES.has(error.code ?? '')
          ? new HostdError('Unavailable', 'The host helper is not installed or not running')
          : new HostdError('Internal', 'The host helper could not be reached'),
      );
    });
    socket.on('close', () => finish(new HostdError('Internal', 'The host helper hung up')));
  });

let transport: HostdTransport = varlinkTransport;

// Tests (and a future remote helper) hand in their own transport; null restores the socket.
export function useHostdTransport(next: HostdTransport | null): void {
  transport = next ?? varlinkTransport;
}

export async function hostd<T>(
  method: string,
  parameters: Record<string, unknown> = {},
  timeoutMs = 20_000,
): Promise<T> {
  return (await transport(method, parameters, timeoutMs)) as T;
}
