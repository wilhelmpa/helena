import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewSocketTransport } from '../../launcher';

let server: Server;
let directory: string;
const sockets = new Set<Socket>();
const original = process.env.HELENA_PREVIEW_LAUNCHER_SOCKET;
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
  if (original === undefined) delete process.env.HELENA_PREVIEW_LAUNCHER_SOCKET;
  else process.env.HELENA_PREVIEW_LAUNCHER_SOCKET = original;
});
async function listen(handle: (socket: Socket) => void) {
  directory = await mkdtemp(join(tmpdir(), 'helena-preview-wire-'));
  process.env.HELENA_PREVIEW_LAUNCHER_SOCKET = join(directory, 'launcher.sock');
  server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    handle(socket);
  });
  await new Promise<void>((resolve) =>
    server.listen(process.env.HELENA_PREVIEW_LAUNCHER_SOCKET, resolve),
  );
}
function frame(kind: number, value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(5);
  header[0] = kind;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}
describe('preview launcher framing', () => {
  it('handles split frames and fixes the protocol version', async () => {
    await listen((socket) =>
      socket.once('data', (data) => {
        expect(JSON.parse(String(data))).toEqual({ v: 1, op: 'preview-status', slug: 'vol' });
        const reply = frame(0x15, { previews: [] });
        socket.write(reply.subarray(0, 3));
        setTimeout(() => socket.end(reply.subarray(3)), 2);
      }),
    );
    expect(await previewSocketTransport({ v: 9, op: 'preview-status', slug: 'vol' }, 1000)).toEqual(
      { previews: [] },
    );
  });
  it('refuses an oversized advertised frame before allocation', async () => {
    await listen((socket) =>
      socket.once('data', () => {
        const header = Buffer.alloc(5);
        header[0] = 0x15;
        header.writeUInt32BE(1024 * 1024, 1);
        socket.end(header);
      }),
    );
    await expect(previewSocketTransport({}, 1000)).rejects.toThrow('exceeded');
  });
  it('passes typed refusal codes through the bounded transport', async () => {
    await listen((socket) =>
      socket.once('data', () =>
        socket.end(frame(0x14, { error: 'not-found', message: 'Preview not found' })),
      ),
    );
    await expect(previewSocketTransport({}, 1000)).rejects.toMatchObject({ code: 'not-found' });
  });
  it('fails a closed or silent connection instead of hanging', async () => {
    await listen(() => {});
    await expect(previewSocketTransport({}, 20)).rejects.toThrow('did not answer');
  });
});
