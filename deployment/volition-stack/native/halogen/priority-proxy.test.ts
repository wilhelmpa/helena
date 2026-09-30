import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises';
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
  const chat = scheduler.acquire('realtime').then((release) => { order.push('chat'); return release; });
  expect(await chat).toBeFunction();
  expect(order).toEqual(['chat']);
  normal!();
  running[0]!();
  (await chat)!();
  expect(await background).toBeFunction();
  running[1]!();
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
  const held = await scheduler.acquire('normal');
  const timeout = scheduler.acquire('normal');
  expect(await timeout).toBeNull();
  const controller = new AbortController();
  const disconnected = scheduler.acquire('normal', controller.signal);
  controller.abort();
  expect(await disconnected).toBeNull();
  held!();
  scheduler.setConfig({ ...DEFAULT_PRIORITY_CONFIG, maxBackground: 1 });
  expect(scheduler.status().config.maxBackground).toBe(1);
});

test('aged background work gets a turn amid a chat burst', async () => {
  let now = 0;
  const scheduler = new PriorityScheduler(DEFAULT_PRIORITY_CONFIG, () => now);
  const occupied = await Promise.all(Array.from({ length: 3 }, () => scheduler.acquire('interactive')));
  const background = scheduler.acquire('background');
  const chats = Array.from({ length: 5 }, () => scheduler.acquire('interactive'));
  now = 46_000;
  occupied[0]!();
  const backgroundRelease = await background;
  expect(backgroundRelease).toBeFunction();
  backgroundRelease!();
  occupied.slice(1).forEach((release) => release!());
  for (const chat of chats) (await chat)!();
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

test('realtime wave is bounded and admits another request when one ends', async () => {
  const scheduler = new PriorityScheduler({ ...DEFAULT_PRIORITY_CONFIG, maxConcurrent: 2,
    reservedInteractive: 1, maxRealtime: 1, realtimeQueueMs: 30 });
  const first = await scheduler.acquire('realtime');
  const second = scheduler.acquire('realtime');
  const third = scheduler.acquire('realtime');
  expect(scheduler.status().queued.realtime).toBe(2);
  first!();
  const release = await second;
  expect(release).toBeFunction();
  expect(await third).toBeNull();
  expect(scheduler.status().fallbacks.realtime).toBe(1);
  release!();
});

test('a full background queue cannot block a spare realtime slot', async () => {
  const scheduler = new PriorityScheduler({ ...DEFAULT_PRIORITY_CONFIG,
    maxQueue: 2, maxQueuedBackground: 2 });
  const running = await Promise.all([scheduler.acquire('background'), scheduler.acquire('background')]);
  const abort = new AbortController();
  const backlog = [scheduler.acquire('background', abort.signal),
    scheduler.acquire('background', abort.signal)];
  expect(scheduler.status().queued.background).toBe(2);
  const realtime = await scheduler.acquire('realtime');
  expect(realtime).toBeFunction();
  realtime!();
  abort.abort();
  await Promise.all(backlog);
  running.forEach((release) => release!());
});

test('a health transition releases queued realtime requests immediately', async () => {
  const scheduler = new PriorityScheduler();
  const running = await Promise.all(Array.from({ length: 2 }, () => scheduler.acquire('realtime')));
  const waiting = scheduler.acquire('realtime');
  expect(scheduler.status().queued.realtime).toBe(1);
  scheduler.setHealthy(false);
  expect(await waiting).toBeNull();
  expect(scheduler.status().fallbacks.realtime).toBe(1);
  running.forEach((release) => release!());
  scheduler.setHealthy(true);
  expect(await scheduler.acquire('realtime')).toBeFunction();
});

test('health stall pauses background, realtime falls back, recovery drains backlog', async () => {
  let healthy = true;
  const backend = createServer((req, res) => {
    if (req.url === '/health' && !healthy) return;
    res.end('{}');
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => backend.close(() => resolve())));
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const port = (backend.address() as { port: number }).port;
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [port, port],
    socketDir: dir, healthCheck: true, readConfig: async () => ({ ...DEFAULT_PRIORITY_CONFIG,
      healthProbeMs: 20, healthTimeoutMs: 20, realtimeQueueMs: 30 }) });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  for (let i = 0; i < 30 && !proxy.scheduler.status().healthy; i++) await tick();
  expect(proxy.scheduler.status().healthy).toBe(true);
  healthy = false;
  for (let i = 0; i < 30 && proxy.scheduler.status().healthy; i++) await tick();
  expect(proxy.scheduler.status().healthy).toBe(false);
  const url = `http://127.0.0.1:${proxy.ports[0]}/v1/chat/completions`;
  const fallback = await fetch(url, { method: 'POST', body: '{}',
    headers: { 'x-volition-halogen-priority': 'realtime' } });
  expect(fallback.status).toBe(502);
  expect(fallback.headers.get('retry-after')).toBeNull();
  expect((await fallback.json()).error.code).toBe('backend_unavailable');
  expect(proxy.scheduler.status().fallbacks.realtime).toBe(1);
  const pending = fetch(url, { method: 'POST', body: '{}',
    headers: { 'x-volition-halogen-priority': 'background' } });
  for (let i = 0; i < 30 && proxy.scheduler.status().queued.background === 0; i++) await tick();
  expect(proxy.scheduler.status().paused.background).toBe(true);
  healthy = true;
  expect((await pending).status).toBe(200);
  expect(proxy.scheduler.status().queued.background).toBe(0);
});

test('chat and runs retain their token requests; voice reply and realtime are bounded', async () => {
  const received: Record<string, unknown>[] = [];
  const backend = createServer(async (req, res) => {
    if (req.url === '/health') { res.end('{}'); return; }
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    received.push(JSON.parse(body) as Record<string, unknown>);
    res.end('{}');
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => backend.close(() => resolve())));
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const port = (backend.address() as { port: number }).port;
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [port, port], socketDir: dir });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${proxy.ports[0]}/v1/chat/completions`;
  const cases = [
    { kind: 'interactive', body: { model: 'fake', max_tokens: 10_000 } },
    { kind: 'normal', body: { model: 'fake', max_completion_tokens: 10_000 } },
    { kind: 'background', body: { model: 'fake' } },
    { kind: 'voice-reply', body: { model: 'fake', max_tokens: 10_000 } },
    { kind: 'realtime', body: { model: 'fake', max_completion_tokens: 10_000 } },
    { kind: 'voice-agent', body: { model: 'fake', max_tokens: 10_000 } },
  ];
  for (const { kind, body } of cases) {
    const response = await fetch(url, { method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-volition-halogen-priority': kind } });
    expect(response.status).toBe(200);
  }
  expect(received).toEqual([
    cases[0]!.body,
    cases[1]!.body,
    cases[2]!.body,
    { model: 'fake', max_tokens: 512 },
    { model: 'fake', max_completion_tokens: 64 },
    cases[5]!.body,
  ]);
  const status = await (await fetch(`http://127.0.0.1:${proxy.ports[0]}/priority/status`)).json();
  expect(status.maxTokensByClass).toEqual({
    interactive: null,
    'voice-reply': 512,
    realtime: 64,
    normal: null,
    background: null,
  });
});

test('a stalled upstream releases its slot and pauses admission', async () => {
  const backend = createServer((_req, _res) => {});
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => backend.close(() => resolve())));
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const port = (backend.address() as { port: number }).port;
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [port, port],
    socketDir: dir, readConfig: async () => ({ ...DEFAULT_PRIORITY_CONFIG, upstreamIdleMs: 30 }) });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${proxy.ports[0]}/v1/chat/completions`, {
    method: 'POST', body: '{}', headers: { 'x-volition-halogen-priority': 'realtime' },
  });
  expect(response.status).toBe(502);
  expect(proxy.scheduler.status().active.realtime).toBe(0);
  expect(proxy.scheduler.status().healthy).toBe(false);
});

test('GET without a body reaches the backend (model list, health)', async () => {
  const backend = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, method: req.method }));
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => backend.close(() => resolve())));
  const port = (backend.address() as { port: number }).port;
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [port, port], socketDir: dir });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${proxy.ports[0]}/v1/models`, {
    signal: AbortSignal.timeout(2_000),
  });
  expect(await response.json()).toEqual({ path: '/v1/models', method: 'GET' });
});

test('administrative pause survives health and config updates until release', async () => {
  const scheduler = new PriorityScheduler();
  const active = await scheduler.acquire('normal');
  scheduler.setAdministrativePaused(true);
  let started = false;
  const waiting = scheduler.acquire('background').then((release) => { started = true; return release; });
  scheduler.setHealthy(true);
  scheduler.setConfig(DEFAULT_PRIORITY_CONFIG);
  active!();
  await tick();
  expect(started).toBe(false);
  expect(scheduler.status().administrativePaused).toBe(true);
  expect(Object.values(scheduler.status().active).every((count) => count === 0)).toBe(true);
  scheduler.setAdministrativePaused(false);
  (await waiting)!();
  expect(started).toBe(true);
});

test('shared admission check fences queued requests before periodic refresh', async () => {
  let paused = false;
  const scheduler = new PriorityScheduler({ ...DEFAULT_PRIORITY_CONFIG, maxConcurrent: 1 });
  scheduler.admissionCheck = () => paused;
  const active = await scheduler.acquire('realtime');
  let admitted = false;
  const queued = scheduler.acquire('interactive').then((release) => { admitted = true; return release; });
  paused = true;
  active!();
  await tick();
  expect(admitted).toBe(false);
  paused = false;
  scheduler.setAdministrativePaused(false);
  (await queued)!();
});


test('proxy reads the durable administrative pause and releases queued HTTP work', async () => {
  const backend = await fakeBackend();
  const dir = await mkdtemp(join(tmpdir(), 'volition-maintenance-'));
  const maintenancePath = join(dir, 'state.json');
  await writeFile(maintenancePath, JSON.stringify({ version: 1, proxyPaused: true }));
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [backend.port, backend.port],
    socketDir: dir, maintenancePath });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${proxy.ports[0]}`;
  const waiting = fetch(`${url}/v1/chat/completions`, { method: 'POST', body: '{}' });
  for (let i = 0; i < 30 && proxy.scheduler.status().queued.normal === 0; i++) await tick();
  const status = await (await fetch(`${url}/priority/status`)).json();
  expect(status.administrativePaused).toBe(true);
  expect(status.active.normal).toBe(0);
  await writeFile(maintenancePath + '.tmp', JSON.stringify({ version: 1, proxyPaused: false }));
  await rename(maintenancePath + '.tmp', maintenancePath);
  const response = await waiting;
  expect(response.status).toBe(200);
  await response.text();
});


test('scheduler reports queue full, timeout, health failure and cancellation separately', async () => {
  const scheduler = new PriorityScheduler({ ...DEFAULT_PRIORITY_CONFIG,
    maxConcurrent: 2, maxInteractive: 1, maxQueuedInteractive: 1, interactiveQueueMs: 20 });
  const held = await scheduler.acquire('interactive');
  const pending = scheduler.acquireWithReason('interactive');
  expect((await scheduler.acquireWithReason('interactive')).reason).toBe('busy');
  expect((await pending).reason).toBe('busy');
  const controller = new AbortController();
  const canceled = scheduler.acquireWithReason('interactive', controller.signal);
  controller.abort();
  expect((await canceled).reason).toBe('aborted');
  expect(scheduler.status().queued.interactive).toBe(0);
  const unhealthy = scheduler.acquireWithReason('interactive');
  scheduler.setHealthy(false);
  scheduler.setHealthy(true);
  expect((await unhealthy).reason).toBe('backend_unavailable');
  held!();
});

test('proxy distinguishes a full queue from an unhealthy backend', async () => {
  const backend = await fakeBackend();
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-'));
  const proxy = await startPriorityProxy({ hostPorts: [0, 0], backendPorts: [backend.port, backend.port],
    socketDir: dir, readConfig: async () => ({ ...DEFAULT_PRIORITY_CONFIG,
      maxInteractive: 1, maxQueuedInteractive: 1 }) });
  cleanups.push(async () => { await proxy.close(); await rm(dir, { recursive: true, force: true }); });
  const held = await proxy.scheduler.acquire('interactive');
  const controller = new AbortController();
  const queued = proxy.scheduler.acquire('interactive', controller.signal);
  const url = `http://127.0.0.1:${proxy.ports[0]}/v1/chat/completions`;
  const send = () => fetch(url, { method: 'POST', body: '{}',
    headers: { 'x-volition-halogen-priority': 'interactive' } });
  const full = await send();
  expect(full.status).toBe(503);
  expect(full.headers.get('retry-after')).toBe('1');
  expect((await full.json()).error.code).toBe('engine_busy');
  proxy.scheduler.setHealthy(false);
  expect(await queued).toBeNull();
  const down = await send();
  expect(down.status).toBe(502);
  expect(down.headers.get('retry-after')).toBeNull();
  expect((await down.json()).error.code).toBe('backend_unavailable');
  held!();
});


test('voice has its own slot while three chats are running', async () => {
  const scheduler = new PriorityScheduler();
  const chats = await Promise.all(Array.from({ length: 3 }, () => scheduler.acquire('interactive')));
  const voice = await scheduler.acquire('realtime');
  try { expect(voice).toBeFunction(); } finally { voice?.(); chats.forEach((release) => release?.()); }
});

test('the fourth chat cannot occupy the voice reservation', async () => {
  const scheduler = new PriorityScheduler();
  const chats = await Promise.all(Array.from({ length: 3 }, () => scheduler.acquire('interactive')));
  const abort = new AbortController();
  const fourth = scheduler.acquire('interactive', abort.signal);
  await tick();
  try { expect(scheduler.status().queued.interactive).toBe(1); }
  finally { abort.abort(); (await fourth)?.(); chats.forEach((release) => release?.()); }
});
