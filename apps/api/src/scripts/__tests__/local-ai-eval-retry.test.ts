import { expect, it } from 'bun:test';
import { retryLocalAiEval, type EvalRetry } from '../local-ai-eval-retry';

it('retries a socket close once after a pause and records the first error', async () => {
  let calls = 0;
  const retries: EvalRetry[] = [];
  const started = Date.now();
  const result = await retryLocalAiEval(
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
    {
      error: 'The socket connection was closed unexpectedly.',
      delayMs: 1_000,
      attempt: 2,
      reason: 'socket_closed',
    },
  ]);
});

it('retains the final error after the single retry', async () => {
  let calls = 0;
  const retries: EvalRetry[] = [];
  await expect(
    retryLocalAiEval(
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

it('does not retry timeouts, permanent HTTP errors or invalid model output', async () => {
  for (const message of [
    'timed out',
    'HTTP 500',
    'HTTP 401',
    'HTTP 400',
    'invalid JSON',
    'NPU readout failed',
  ]) {
    let calls = 0;
    const retries: EvalRetry[] = [];
    await expect(
      retryLocalAiEval(
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

it('retries proxy HTTP 502 and 503 with bounded exponential backoff', async () => {
  let calls = 0;
  const retries: EvalRetry[] = [];
  const result = await retryLocalAiEval(
    async () => {
      calls++;
      if (calls <= 2) throw new Error(`/chat/completions: HTTP ${calls === 1 ? 502 : 503}`);
      return 'done';
    },
    (retry) => retries.push(retry),
  );
  expect(result).toBe('done');
  expect(calls).toBe(3);
  expect(retries.map((retry) => retry.delayMs)).toEqual([1_000, 2_000]);
  expect(retries.map((retry) => retry.attempt)).toEqual([2, 3]);
  expect(retries.every((retry) => retry.reason === 'proxy_unavailable')).toBe(true);
});

it('keeps the final backend_unavailable after three attempts', async () => {
  let calls = 0;
  const retries: EvalRetry[] = [];
  await expect(
    retryLocalAiEval(
      async () => {
        calls++;
        throw Object.assign(new Error('backend temporarily unavailable'), {
          code: 'backend_unavailable',
        });
      },
      (retry) => retries.push(retry),
    ),
  ).rejects.toThrow('backend temporarily unavailable');
  expect(calls).toBe(3);
  expect(retries).toHaveLength(2);
});
