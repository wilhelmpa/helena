import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_SOCKET_PATH,
  callGateway,
  gatewayRequest,
  socketPathFrom,
  toolResult,
} from './shim-protocol';

let root: string | undefined;
let server: net.Server | undefined;

afterEach(async () => {
  server?.close();
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function tempDir(): Promise<string> {
  root = await mkdtemp(path.join(os.tmpdir(), 'browser-gateway-shim-'));
  return root;
}

// A plain net server speaking the wire protocol: one JSON line in, one JSON line out.
function fakeGateway(target: string, answer: (request: Record<string, unknown>) => unknown) {
  return new Promise<void>((resolve) => {
    server = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const all = Buffer.concat(chunks);
        const newline = all.indexOf(0x0a);
        if (newline === -1) return;
        const request = JSON.parse(all.subarray(0, newline).toString('utf8'));
        socket.end(`${JSON.stringify(answer(request))}\n`);
      });
    });
    server.listen(target, () => resolve());
  });
}

describe('gatewayRequest', () => {
  it('sends tool, args and the agent key, with run and message ids when set', async () => {
    expect(
      await gatewayRequest(
        'browser_click',
        { ref: 'e3' },
        { ITSAPLAN_API_KEY: 'k', ITSAPLAN_RUN_ID: '42', ITSAPLAN_MESSAGE_ID: '7' },
      ),
    ).toEqual({
      tool: 'browser_click',
      args: { ref: 'e3' },
      agentKey: 'k',
      runId: 42,
      messageId: 7,
    });
  });

  it('treats a placeholder Hermes left unexpanded as not set', async () => {
    expect(
      await gatewayRequest('browser_status', undefined, {
        ITSAPLAN_API_KEY: 'k',
        ITSAPLAN_RUN_ID: '${ITSAPLAN_RUN_ID}',
        ITSAPLAN_MESSAGE_ID: '${ITSAPLAN_MESSAGE_ID}',
      }),
    ).toEqual({ tool: 'browser_status', args: {}, agentKey: 'k' });
    expect(socketPathFrom({ BROWSER_GATEWAY_SOCKET: '${BROWSER_GATEWAY_SOCKET}' })).toBe(
      DEFAULT_SOCKET_PATH,
    );
    expect(socketPathFrom({ BROWSER_GATEWAY_SOCKET: '/run/x/gateway.sock' })).toBe(
      '/run/x/gateway.sock',
    );
  });

  it("reads an upload with the caller's own rights and sends its bytes, not its path", async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'report.pdf'), Buffer.from('%PDF-1.4 test'));
    const request = await gatewayRequest(
      'browser_upload',
      { ref: 'e5', path: 'report.pdf' },
      { ITSAPLAN_API_KEY: 'k' },
      dir,
    );
    expect(request.args).toEqual({ ref: 'e5' });
    expect(request.upload).toEqual({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('%PDF-1.4 test').toString('base64'),
    });
  });

  it('refuses an upload of a file that is not there or not a file', async () => {
    const dir = await tempDir();
    await expect(
      gatewayRequest('browser_upload', { ref: 'e5', path: 'missing.pdf' }, {}, dir),
    ).rejects.toThrow(/does not exist/);
    await expect(
      gatewayRequest('browser_upload', { ref: 'e5', path: dir }, {}, dir),
    ).rejects.toThrow(/not a file/);
  });
});

describe('toolResult', () => {
  it('maps text, errors and a screenshot image', () => {
    expect(toolResult({ ok: true, content: 'done' })).toEqual({
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    });
    expect(toolResult({ ok: false, error: 'no' })).toEqual({
      content: [{ type: 'text', text: 'no' }],
      isError: true,
    });
    expect(
      toolResult({
        ok: true,
        content: 'Screenshot',
        image: { data: 'AAA', mimeType: 'image/png' },
      }),
    ).toEqual({
      content: [
        { type: 'image', data: 'AAA', mimeType: 'image/png' },
        { type: 'text', text: 'Screenshot' },
      ],
      isError: false,
    });
    expect(toolResult('nonsense').isError).toBe(true);
  });
});

describe('callGateway', () => {
  it('sends one line and maps the answer', async () => {
    const target = path.join(await tempDir(), 'gateway.sock');
    let received: Record<string, unknown> | undefined;
    await fakeGateway(target, (request) => {
      received = request;
      return { ok: true, content: 'Controlled by: nobody (free).' };
    });
    const result = await callGateway(
      'browser_status',
      { project: 'verve' },
      { socketPath: target, env: { ITSAPLAN_API_KEY: 'the-agent-key' } },
    );
    expect(received).toEqual({
      tool: 'browser_status',
      args: { project: 'verve' },
      agentKey: 'the-agent-key',
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Controlled by: nobody (free).' }],
      isError: false,
    });
  });

  it('reports a gateway that is not there as a tool error, never a throw', async () => {
    const missing = path.join(await tempDir(), 'none.sock');
    const result = await callGateway('browser_status', {}, { socketPath: missing, env: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toMatch(
      /Cannot reach the project browser/,
    );
  });

  it('reports an unreadable answer as a tool error', async () => {
    const target = path.join(await tempDir(), 'gateway.sock');
    await new Promise<void>((resolve) => {
      server = net.createServer((socket) => socket.on('data', () => socket.end('not json\n')));
      server.listen(target, () => resolve());
    });
    const result = await callGateway('browser_status', {}, { socketPath: target, env: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/unreadable/);
  });

  it('carries a large upload and a large answer across chunk boundaries', async () => {
    const dir = await tempDir();
    const target = path.join(dir, 'gateway.sock');
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    await writeFile(path.join(dir, 'big.bin'), big);
    let size = 0;
    await fakeGateway(target, (request) => {
      size = Buffer.from((request.upload as { data: string }).data, 'base64').length;
      return { ok: true, content: 'x'.repeat(2 * 1024 * 1024) };
    });
    const result = await callGateway(
      'browser_upload',
      { ref: 'e1', path: 'big.bin' },
      { socketPath: target, env: {}, cwd: dir },
    );
    expect(size).toBe(big.length);
    expect(result.isError).toBe(false);
    expect((result.content[0] as { text: string }).text.length).toBe(2 * 1024 * 1024);
  });
});
