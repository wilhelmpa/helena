import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createEvent, createEventBus } from '@helena/sdk';
import { ENGINE_EVENT_TARGETS, enqueueEngineEvents } from '@repo/db';
import { workerEventTransport } from '../../engine-delivery';

// The worker's half of the engine's event transport: an event stored on the engine's
// worker queue reaches each durable subscriber of the worker's plugins once, and again
// after it failed; a subscriber that is not durable is never served from the queue.

process.env.HELENA_ENGINE_POLL_MS ??= '100';
process.env.HELENA_EVENT_RETRY_SECONDS ??= '1';
process.env.HELENA_ENGINE_EXECUTOR_ID ??= 'worker-tests';

const WORKER_ONLY = [ENGINE_EVENT_TARGETS[1]];
const seen: string[] = [];
let failuresLeft = 1;
let delivery: { stop(): Promise<void> } | null = null;

beforeAll(async () => {
  const bus = createEventBus();
  bus.subscribe(
    'test.*',
    (event) => {
      if (event.type === 'test.flaky' && failuresLeft-- > 0) throw new Error('not yet');
      seen.push(`${event.type}:${event.id}`);
    },
    { id: 'recorder', durable: true },
  );
  bus.subscribe('test.*', () => seen.push('in-process'), { id: 'quick' });
  delivery = await workerEventTransport.start(() => bus.subscriptions());
});

afterAll(async () => {
  await delivery?.stop();
});

async function until(check: () => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out, seen: ${JSON.stringify(seen)}`);
    await Bun.sleep(100);
  }
}

describe('engine event delivery in the worker', () => {
  it('hands each stored event to every durable subscriber once, and again after it failed', async () => {
    const plain = createEvent({ type: 'test.plain', data: {} });
    const flaky = createEvent({ type: 'test.flaky', data: {} });
    const other = createEvent({ type: 'other.thing', data: {} });
    await enqueueEngineEvents([plain, flaky, other], undefined, WORKER_ONLY);
    // Stored again (a retry of the change): nothing new.
    await enqueueEngineEvents([plain], undefined, WORKER_ONLY);
    await until(() => seen.includes(`test.flaky:${flaky.id}`) && seen.length >= 2);
    await Bun.sleep(500);
    expect(seen.filter((entry) => entry === `test.plain:${plain.id}`)).toHaveLength(1);
    expect(seen).toContain(`test.flaky:${flaky.id}`);
    expect(seen).not.toContain('in-process');
    expect(seen.some((entry) => entry.startsWith('other.thing'))).toBe(false);
  }, 30_000);
});
