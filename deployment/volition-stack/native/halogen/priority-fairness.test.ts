import { expect, test } from 'bun:test';
import { DEFAULT_PRIORITY_CONFIG } from '../../../../packages/sdk/src/halogen-priority';
import { PriorityScheduler } from './priority-scheduler';

test('background gets the next free slot under continuous interactive demand by sixty seconds', async () => {
  let now = 0;
  const scheduler = new PriorityScheduler(
    { ...DEFAULT_PRIORITY_CONFIG, agingMs: 120_000 },
    () => now,
  );
  const abort = new AbortController();
  const running = await Promise.all(
    Array.from({ length: 4 }, () => scheduler.acquire('interactive')),
  );
  const background = scheduler.acquire('background', abort.signal);
  const chats = Array.from({ length: 8 }, () => scheduler.acquire('interactive', abort.signal));
  now = 60_000;
  running[0]!();
  const status = scheduler.status();
  abort.abort();
  running.slice(1).forEach((release) => release!());
  const backgroundRelease = await background;
  backgroundRelease?.();
  for (const chat of chats) (await chat)?.();
  expect(status.active.background).toBe(1);
  expect(status.active.interactive).toBe(3);
});

test('the minimum quota serves the oldest background job and preserves interactive capacity', async () => {
  let now = 0;
  const scheduler = new PriorityScheduler(DEFAULT_PRIORITY_CONFIG, () => now);
  const abort = new AbortController();
  const running = await Promise.all(
    Array.from({ length: 4 }, () => scheduler.acquire('interactive')),
  );
  const order: string[] = [];
  const backgrounds = ['first', 'second'].map((name) =>
    scheduler.acquire('background', abort.signal).then((release) => {
      if (release) order.push(name);
      return release;
    }),
  );
  const chat = scheduler.acquire('interactive', abort.signal);
  now = 44_999;
  running[0]!();
  const chatRelease = await chat;
  expect(scheduler.status().active.background).toBe(0);
  now = 45_000;
  running[1]!();
  const first = await backgrounds[0]!;
  expect(order).toEqual(['first']);
  running[2]!();
  expect(scheduler.status().queued.background).toBe(1);
  expect(scheduler.status().active.background).toBe(1);
  first!();
  const second = await backgrounds[1]!;
  expect(order).toEqual(['first', 'second']);
  abort.abort();
  second!();
  chatRelease!();
  running[3]!();
});

test('aging admits background into spare capacity without another release', async () => {
  const scheduler = new PriorityScheduler({ ...DEFAULT_PRIORITY_CONFIG, maxBackgroundWaitMs: 20 });
  const interactive = await scheduler.acquire('interactive');
  const abort = new AbortController();
  const cleanup = setTimeout(() => abort.abort(), 300);
  try {
    const background = await scheduler.acquire('background', abort.signal);
    expect(background).toBeFunction();
    background?.();
  } finally {
    clearTimeout(cleanup);
    interactive!();
    abort.abort();
  }
});

test('wait percentiles use a bounded recent window per class including cancellation', async () => {
  let now = 0;
  const scheduler = new PriorityScheduler(
    { ...DEFAULT_PRIORITY_CONFIG, waitTimeSampleSize: 3, maxConcurrent: 2, maxNormal: 1 },
    () => now,
  );
  const held = await scheduler.acquire('normal');
  for (const delay of [10, 40, 20, 30]) {
    const abort = new AbortController();
    const pending = scheduler.acquire('normal', abort.signal);
    now += delay;
    abort.abort();
    await pending;
  }
  expect(scheduler.status().waitTimesMsByClass.normal).toEqual({ count: 3, p50: 30, max: 40 });
  expect(scheduler.status().waitTimesMsByClass.interactive).toEqual({ count: 0, p50: 0, max: 0 });
  scheduler.setConfig({ ...DEFAULT_PRIORITY_CONFIG, waitTimeSampleSize: 2 });
  expect(scheduler.status().waitTimesMsByClass.normal).toEqual({ count: 2, p50: 20, max: 30 });
  held!();
});

test('fairness preserves administrative pauses, backend health and reserved interactive slots', async () => {
  let now = 0;
  const scheduler = new PriorityScheduler(
    { ...DEFAULT_PRIORITY_CONFIG, reservedInteractive: 3 },
    () => now,
  );
  const held = await scheduler.acquire('normal');
  const abort = new AbortController();
  const pending = scheduler.acquire('background', abort.signal);
  now = 60_000;
  scheduler.setAdministrativePaused(true);
  held!();
  expect(scheduler.status().active.background).toBe(0);
  scheduler.setHealthy(false);
  scheduler.setAdministrativePaused(false);
  expect(scheduler.status().active.background).toBe(0);
  scheduler.setHealthy(true);
  const background = await pending;
  expect(background).toBeFunction();
  const interactive = await Promise.all(
    Array.from({ length: 3 }, () => scheduler.acquire('interactive')),
  );
  expect(scheduler.status().active).toMatchObject({ background: 1, interactive: 3 });
  background!();
  interactive.forEach((release) => release!());
  abort.abort();
});

test('priority status exposes per-class recent wait statistics over HTTP', async () => {
  const { createServer } = await import('node:http');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { startPriorityProxy } = await import('./priority-proxy');
  const backend = createServer((_req, res) => res.end('{}'));
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const port = (backend.address() as { port: number }).port;
  const dir = await mkdtemp(join(tmpdir(), 'volition-priority-fairness-'));
  const proxy = await startPriorityProxy({
    hostPorts: [0, 0],
    backendPorts: [port, port],
    socketDir: dir,
  });
  try {
    const base = `http://127.0.0.1:${proxy.ports[0]}`;
    const result = await fetch(`${base}/chat/completions`, { method: 'POST', body: '{}' });
    await result.text();
    const response = await fetch(`${base}/priority/status`);
    const status = await response.json();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(status.config.waitTimeSampleSize).toBe(128);
    expect(status.waitTimesMsByClass).toEqual({
      interactive: { count: 0, p50: 0, max: 0 },
      realtime: { count: 0, p50: 0, max: 0 },
      normal: { count: 1, p50: 0, max: 0 },
      background: { count: 0, p50: 0, max: 0 },
    });
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
