import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostdError, hostd, useHostdTransport, varlinkTransport } from '../../hostd';

// The Varlink client against a small server on a Unix socket: one NUL-terminated JSON
// message each way, errors by name.

let server: Server | null = null;
const saved = process.env.HELENA_HOSTD_SOCKET;

afterEach(() => {
  server?.close();
  server = null;
  if (saved === undefined) delete process.env.HELENA_HOSTD_SOCKET;
  else process.env.HELENA_HOSTD_SOCKET = saved;
  useHostdTransport(null);
});

function listen(answer: (request: Record<string, unknown>) => unknown): Promise<string> {
  const path = join(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'hostd-')), 'hostd.sock');
  server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf(0);
      if (end < 0) return;
      const request = JSON.parse(buffer.subarray(0, end).toString()) as Record<string, unknown>;
      socket.end(JSON.stringify(answer(request)) + '\0');
    });
  });
  process.env.HELENA_HOSTD_SOCKET = path;
  return new Promise((resolve) => server!.listen(path, () => resolve(path)));
}

describe('the host helper client', () => {
  it('calls a method of io.helena.hostd and answers its result', async () => {
    let seen: Record<string, unknown> | null = null;
    await listen((request) => {
      seen = request;
      return { parameters: { result: { memory: { totalBytes: 1 } } } };
    });
    useHostdTransport(varlinkTransport);
    const result = await hostd<{ memory: { totalBytes: number } }>('SystemStatus', { fresh: true });
    expect(result.memory.totalBytes).toBe(1);
    expect(seen!).toEqual({ method: 'io.helena.hostd.SystemStatus', parameters: { fresh: true } });
  });

  it('sends a root command and its revocation epoch over Varlink', async () => {
    await listen((request) => {
      expect(request).toEqual({
        method: 'io.helena.hostd.RunPrivileged',
        parameters: {
          id: 'a'.repeat(32),
          command: 'id -u',
          seconds: 30,
          epoch: 7,
        },
      });
      return {
        parameters: { result: { unit: 'volition-root-proof.service', exitCode: 0, output: '0\n' } },
      };
    });
    const result = await hostd('RunPrivileged', {
      id: 'a'.repeat(32),
      command: 'id -u',
      seconds: 30,
      epoch: 7,
    });
    expect(result).toMatchObject({ exitCode: 0, output: '0\n' });
  });

  it('turns a Varlink error into a HostdError with its code and parameter', async () => {
    await listen(() => ({
      error: 'io.helena.hostd.InvalidParameter',
      parameters: { message: 'limit must be 70–95', parameter: 'limit' },
    }));
    const error = (await hostd('SetGuard', { limit: 1 }).catch((e: unknown) => e)) as HostdError;
    expect(error).toBeInstanceOf(HostdError);
    expect(error.code).toBe('InvalidParameter');
    expect(error.parameter).toBe('limit');
    expect(error.message).toBe('limit must be 70–95');
  });

  it('a refused caller and a missing socket are "Unavailable"', async () => {
    await listen(() => ({ error: 'org.varlink.service.PermissionDenied', parameters: {} }));
    expect(((await hostd('Capabilities').catch((e: unknown) => e)) as HostdError).code).toBe(
      'Unavailable',
    );
    server?.close();
    server = null;
    process.env.HELENA_HOSTD_SOCKET = join(tmpdir(), 'helena-hostd-missing.sock');
    expect(((await hostd('Capabilities').catch((e: unknown) => e)) as HostdError).code).toBe(
      'Unavailable',
    );
  });

  it('gives up after its timeout', async () => {
    const path = join(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'hostd-')), 'hostd.sock');
    server = createServer(() => {});
    await new Promise<void>((resolve) => server!.listen(path, () => resolve()));
    process.env.HELENA_HOSTD_SOCKET = path;
    const error = (await hostd('Capabilities', {}, 50).catch((e: unknown) => e)) as HostdError;
    expect(error.code).toBe('Timeout');
  });
});
