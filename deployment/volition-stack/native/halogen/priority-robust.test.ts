import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PRIORITY_CONFIG,
  type PriorityConfig,
} from '../../../../packages/sdk/src/halogen-priority';
import { startPriorityProxy } from './priority-proxy';
import { PriorityScheduler } from './priority-scheduler';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  config: Partial<PriorityConfig>,
  healthCheck = false,
) {
  const backend = createServer(handler);
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise((resolve) => backend.close(() => resolve())));
  const socketDir = await mkdtemp(join(tmpdir(), 'volition-priority-robust-'));
  const port = (backend.address() as { port: number }).port;
  const proxy = await startPriorityProxy({
    hostPorts: [0, 0],
    backendPorts: [port, port],
    socketDir,
    healthCheck,
    maintenancePath: join(socketDir, 'maintenance.json'),
    readConfig: async () => ({ ...DEFAULT_PRIORITY_CONFIG, ...config }),
  });
  cleanups.push(async () => {
    await proxy.close();
    await rm(socketDir, { recursive: true, force: true });
  });
  return { ...proxy, url: `http://127.0.0.1:${proxy.ports[0]}/v1/chat/completions` };
}

test('only consecutive failed health probes exhaust the configurable threshold', async () => {
  const scheduler = new PriorityScheduler({
    ...DEFAULT_PRIORITY_CONFIG,
    healthFailureThreshold: 3,
    maxInteractive: 1,
  });
  const held = await scheduler.acquire('interactive');
  const queued = scheduler.acquireWithReason('interactive');
  scheduler.recordHealthProbe(false);
  scheduler.recordHealthProbe(false);
  expect(scheduler.status().healthy).toBe(true);
  expect(scheduler.status().queued.interactive).toBe(1);
  scheduler.recordHealthProbe(true);
  scheduler.recordHealthProbe(false);
  scheduler.recordHealthProbe(false);
  expect(scheduler.status().healthy).toBe(true);
  scheduler.recordHealthProbe(false);
  expect((await queued).reason).toBe('backend_unavailable');
  expect(scheduler.status().healthy).toBe(false);
  held!();
  scheduler.recordHealthProbe(true);
  expect(scheduler.status().healthy).toBe(true);
  (await scheduler.acquire('interactive'))!();
});

test('stream data keeps admission healthy through failed probes, then failures mark it down', async () => {
  let healthy = true;
  const proxy = await fixture(
    (req, res) => {
      if (req.url === '/health') {
        res.writeHead(healthy ? 200 : 503);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      const interval = setInterval(() => res.write('data: token\n\n'), 10);
      const end = setTimeout(() => res.end('data: [DONE]\n\n'), 250);
      res.on('close', () => {
        clearInterval(interval);
        clearTimeout(end);
      });
    },
    { healthProbeMs: 20, healthTimeoutMs: 20, healthFailureThreshold: 3, upstreamIdleMs: 80 },
    true,
  );
  const response = await fetch(proxy.url, {
    method: 'POST',
    body: JSON.stringify({ stream: true }),
    headers: { 'content-type': 'application/json' },
  });
  healthy = false;
  await Bun.sleep(120);
  expect(proxy.scheduler.status().healthy).toBe(true);
  expect(proxy.scheduler.status().active.normal).toBe(1);
  await response.text();
  for (let i = 0; i < 50 && proxy.scheduler.status().healthy; i++) await Bun.sleep(10);
  expect(proxy.scheduler.status().healthy).toBe(false);
});

test('non-streaming generation can exceed idle timeout and queue time does not consume its limit', async () => {
  const proxy = await fixture(
    (_req, res) => {
      const timer = setTimeout(
        () => res.end(JSON.stringify({ choices: [{ message: { content: 'done' } }] })),
        80,
      );
      res.on('close', () => clearTimeout(timer));
    },
    { maxBackground: 1, upstreamIdleMs: 20, nonStreamingTimeoutMs: 120 },
  );
  const held = await proxy.scheduler.acquire('background');
  const pending = fetch(proxy.url, {
    method: 'POST',
    body: JSON.stringify({ stream: false }),
    headers: { 'content-type': 'application/json', 'x-volition-halogen-priority': 'background' },
  });
  for (let i = 0; i < 50 && !proxy.scheduler.status().queued.background; i++) await Bun.sleep(5);
  expect(proxy.scheduler.status().queued.background).toBe(1);
  await Bun.sleep(160);
  held!();
  const response = await pending;
  expect(response.status).toBe(200);
  expect((await response.json()).choices[0].message.content).toBe('done');
  expect(proxy.scheduler.status().active.background).toBe(0);
});

test('non-streaming generation still has a total deadline and releases its slot', async () => {
  let disconnected = false;
  const proxy = await fixture(
    (_req, res) => {
      res.on('close', () => {
        disconnected = true;
      });
    },
    { upstreamIdleMs: 20, nonStreamingTimeoutMs: 80 },
  );
  const started = Date.now();
  const response = await fetch(proxy.url, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  expect(response.status).toBe(502);
  expect((await response.json()).error.code).toBe('backend_unavailable');
  expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  expect(proxy.scheduler.status().active.normal).toBe(0);
  expect(proxy.scheduler.status().healthy).toBe(true);
  for (let i = 0; i < 30 && !disconnected; i++) await Bun.sleep(5);
  expect(disconnected).toBe(true);
});

test('partial non-streaming response bytes cannot extend the total deadline', async () => {
  const proxy = await fixture(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
      const timer = setInterval(() => res.write(' '), 10);
      res.on('close', () => clearInterval(timer));
    },
    { upstreamIdleMs: 20, nonStreamingTimeoutMs: 80 },
  );
  const response = await fetch(proxy.url, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  await expect(response.text()).rejects.toThrow();
  expect(proxy.scheduler.status().active.normal).toBe(0);
});

test('disconnect during non-streaming generation releases the slot before the total deadline', async () => {
  let started = false;
  let disconnected = false;
  const proxy = await fixture(
    (_req, res) => {
      started = true;
      res.on('close', () => {
        disconnected = true;
      });
    },
    { upstreamIdleMs: 20, nonStreamingTimeoutMs: 5_000 },
  );
  const controller = new AbortController();
  const pending = fetch(proxy.url, {
    method: 'POST',
    body: '{}',
    signal: controller.signal,
    headers: { 'content-type': 'application/json' },
  }).catch(() => null);
  for (let i = 0; i < 30 && !started; i++) await Bun.sleep(5);
  expect(started).toBe(true);
  controller.abort();
  await pending;
  for (let i = 0; i < 30 && (!disconnected || proxy.scheduler.status().active.normal); i++)
    await Bun.sleep(5);
  expect(disconnected).toBe(true);
  expect(proxy.scheduler.status().active.normal).toBe(0);
});
