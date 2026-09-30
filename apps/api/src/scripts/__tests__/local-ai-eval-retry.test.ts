import { expect, it } from 'bun:test';
import { retrySocketClosed, type SocketRetry } from '../local-ai-eval-retry';

it('retries a socket close once after a pause and records the first error', async () => {
  let calls = 0;
  const retries: SocketRetry[] = [];
  const started = Date.now();
  const result = await retrySocketClosed(
    async () => {
      calls++;
      if (calls === 1) throw new Error('The socket connection was closed unexpectedly.');
      return 'done';
    },
    (retry) => retries.push(retry),
  );
  expect(result).toBe('done');
  expect(calls).toBe(2);
  expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  expect(retries).toEqual([
    { error: 'The socket connection was closed unexpectedly.', delayMs: 1_000 },
  ]);
});

it('retains the final error after the single retry', async () => {
  let calls = 0;
  const retries: SocketRetry[] = [];
  await expect(
    retrySocketClosed(
      async () => {
        calls++;
        throw new Error('socket closed');
      },
      (retry) => retries.push(retry),
    ),
  ).rejects.toThrow('socket closed');
  expect(calls).toBe(2);
  expect(retries).toHaveLength(1);
});

it('does not retry timeouts, HTTP errors or invalid model output', async () => {
  for (const message of ['timed out', 'HTTP 500', 'invalid JSON', 'NPU readout failed']) {
    let calls = 0;
    const retries: SocketRetry[] = [];
    await expect(
      retrySocketClosed(
        async () => {
          calls++;
          throw new Error(message);
        },
        (retry) => retries.push(retry),
      ),
    ).rejects.toThrow(message);
    expect(calls).toBe(1);
    expect(retries).toEqual([]);
  }
});
