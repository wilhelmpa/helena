import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PRIORITY_CONFIG } from '../../../../packages/sdk/src/halogen-priority';
import { startPriorityProxy } from './priority-proxy';
import { PriorityScheduler } from './priority-scheduler';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('chat uses the reserved slot and overtakes queued background work', async () => {
  const scheduler = new PriorityScheduler();
  const running = await Promise.all(Array.from({ length: 2 }, () => scheduler.acquire('background')));
  const normal = await scheduler.acquire('normal');
  const order: string[] = [];
  const background = scheduler.acquire('background').then((release) => { order.push('background'); return release; });
  const chat = scheduler.acquire('interactive').then((release) => { order.push('chat'); return release; });
  expect(await chat).toBeFunction();
  expect(order).toEqual(['chat']);
  normal!();
  running[0]!();
  expect(await background).toBeFunction();
  running[1]!();
  (await chat)!();
  (await background)!();
});

test('FIFO within a class, timeout, disconnect and config changes', async () => {
  const scheduler = new PriorityScheduler({ ...DEFAULT_PRIORITY_CONFIG, maxConcurrent: 2,
    reservedInteractive: 1, maxBackground: 1, queueTimeoutMs: 30 });
  const occupied = await scheduler.acquire('normal');
  const first = scheduler.acquire('normal');
  const second = scheduler.acquire('normal');
  expect(scheduler.status().queued.normal).toBe(2);
  occupied!();
  const firstRelease = await first;
  expect(firstRelease).toBeFunction();
  expect(scheduler.status().queued.normal).toBe(1);
  firstRelease!();
  (await second)!();
  const held = await scheduler.acquire('background');
  const timeout = scheduler.acquire('background');
  expect(await timeout).toBeNull();
  const controller = new AbortController();
  const disconnected = scheduler.acquire('background', controller.signal);
  controller.abort();
  expect(await disconnected).toBeNull();
  held!();
  scheduler.setConfig({ ...DEFAULT_PRIORITY_CONFIG, maxBackground: 1 });
  expect(scheduler.status().config.maxBackground).toBe(1);
});

test('aged background work gets a turn after a bounded chat burst', async () => {
  let now = 0;
  const scheduler = new PriorityScheduler(DEFAULT_PRIORITY_CONFIG, () => now);
  const occupied = await Promise.all(Array.from({ length: 4 }, () => scheduler.acquire('interactive')));
  const background = scheduler.acquire('background');
  const chats = Array.from({ length: 5 }, () => scheduler.acquire('interactive'));
  now = 21_000;
  occupied[0]!();
  let release = await chats[0]!;
  for (const chat of chats.slice(1, 4)) {
    release!();
    release = await chat;
  }
  expect(scheduler.status().queued.background).toBe(1);
  release!();
  const backgroundRelease = await background;
  expect(backgroundRelease).toBeFunction();
  backgroundRelease!();
  occupied.slice(1).forEach((release) => release!());
  (await chats[4])!();
});

async function fakeBackend() {
  const connections = new Set<import('node:http').ServerResponse>();
  const server = createServer((req, res) => {
    connections.add(res);
    res.on('close', () => connections.delete(res));
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => { if (!res.destroyed) res.end('data: second\n\n'); }, 30);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { port: (server.address() as { port: number }).port, connections };
}

test('SSE passes through and client disconnect frees the slot', async () => {
  const backend = await fakeBackend();
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [backend.port, backend.port],
    socketDir: dir });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const port = proxy.ports[0];
  const stream = await fetch(`http://127.0.0.1:${port}/stream`, {
    method: 'POST', body: '{}', headers: { 'x-volition-halogen-priority': 'interactive' },
  });
  expect(stream.headers.get('content-type')).toBe('text/event-stream');
  expect(await stream.text()).toBe('data: first\n\ndata: second\n\n');
  expect(proxy.scheduler.status().active.interactive).toBe(0);

  let closed = false;
  const slow = createServer((_req, res) => { res.on('close', () => { closed = true; }); });
  await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => slow.close(() => resolve())));
  const slowDir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const slowProxy = await startPriorityProxy({ hostPorts: [0, 0],
    backendPorts: [(slow.address() as { port: number }).port, backend.port], socketDir: slowDir });
  cleanups.push(async () => { await slowProxy.close(); await rm(slowDir, { recursive: true, force: true }); });
  const abort = new AbortController();
  const pending = fetch(`http://127.0.0.1:${slowProxy.ports[0]}/slow`, {
    method: 'POST', body: '{}', signal: abort.signal,
  }).catch(() => null);
  for (let i = 0; i < 30 && slowProxy.scheduler.status().active.normal === 0; i++) await tick();
  abort.abort();
  await pending;
  for (let i = 0; i < 30 && (!closed || slowProxy.scheduler.status().active.normal); i++) await tick();
  expect(closed).toBe(true);
  expect(slowProxy.scheduler.status().active.normal).toBe(0);
});

test('isolated socket fixes the class even when a client sends a priority header', async () => {
  const backend = await fakeBackend();
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [backend.port, backend.port],
    socketDir: dir });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const result = await new Promise<string>((resolve, reject) => {
    const req = request({ socketPath: join(dir, 'normal-8731.sock'), path: '/v1/chat/completions',
      method: 'POST', headers: { 'x-volition-halogen-priority': 'interactive' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(String(res.statusCode)));
    });
    req.on('error', reject);
    req.end('{}');
  });
  expect(result).toBe('200');
  expect(proxy.scheduler.status().active.interactive).toBe(0);
});

test('configured queue timeout returns 503 and Retry-After', async () => {
  let finish: (() => void) | undefined;
  const backend = createServer((_req, res) => { finish = () => res.end('{}'); });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => backend.close(() => resolve())));
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const port = (backend.address() as { port: number }).port;
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [port, port],
    socketDir: dir, readConfig: async () => ({ ...DEFAULT_PRIORITY_CONFIG,
      maxConcurrent: 2, reservedInteractive: 1, maxBackground: 1, queueTimeoutMs: 30 }) });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${proxy.ports[0]}/v1/chat/completions`;
  const first = fetch(url, { method: 'POST', body: '{}' });
  for (let i = 0; i < 30 && !finish; i++) await tick();
  expect(finish).toBeFunction();
  const secondPending = fetch(url, { method: 'POST', body: '{}' });
  for (let i = 0; i < 30 && proxy.scheduler.status().queued.normal === 0; i++) await tick();
  const status = await (await fetch(`http://127.0.0.1:${proxy.ports[0]}/priority/status`)).json();
  expect(status.queued.normal).toBe(1);
  expect(status.config.queueTimeoutMs).toBe(30);
  const second = await secondPending;
  expect(second.status).toBe(503);
  expect(second.headers.get('retry-after')).toBe('1');
  expect((await second.json()).error.code).toBe('engine_busy');
  finish!();
  expect((await first).status).toBe(200);
});

test('fake-backend load keeps four slots and starts chat before the background backlog', async () => {
  const order: string[] = [];
  let active = 0;
  let peak = 0;
  const backend = createServer((req, res) => {
    order.push(req.url ?? '');
    active++;
    peak = Math.max(peak, active);
    setTimeout(() => { active--; res.end('{}'); }, 25);
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => backend.close(() => resolve())));
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const port = (backend.address() as { port: number }).port;
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [port, port],
    socketDir: dir });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${proxy.ports[0]}`;
  const backgrounds = Array.from({ length: 20 }, () => fetch(`${url}/background`, {
    method: 'POST', body: '{}', headers: { 'x-volition-halogen-priority': 'background' },
  }));
  for (let i = 0; i < 30 && proxy.scheduler.status().queued.background === 0; i++) await tick();
  expect(proxy.scheduler.status().queued.background).toBeGreaterThan(0);
  const chats = Array.from({ length: 4 }, () => fetch(`${url}/chat`, {
    method: 'POST', body: '{}', headers: { 'x-volition-halogen-priority': 'interactive' },
  }));
  const results = await Promise.all([...backgrounds, ...chats]);
  expect(results.every((response) => response.status === 200)).toBe(true);
  expect(peak).toBeLessThanOrEqual(4);
  expect(order.indexOf('/chat')).toBeLessThan(order.findIndex((entry, index) =>
    entry === '/background' && index >= 2));
});
