import { expect, it } from 'bun:test';
import { StageRevoked, withStageGuard } from './stage-request';

it('never dispatches when the caller aborts while the initial permission read waits', async () => {
  const controller = new AbortController();
  let release!: (allowed: boolean) => void;
  const permission = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const result = withStageGuard(
    () => permission,
    controller.signal,
    async () => {
      calls++;
      return 'late';
    },
  );
  controller.abort();
  release(true);
  await expect(result).rejects.toBeInstanceOf(StageRevoked);
  expect(calls).toBe(0);
});

it('hands back promptly even when an already dispatched provider ignores abort', async () => {
  let allowed = true;
  let seenSignal: AbortSignal | undefined;
  const result = withStageGuard(
    async () => allowed,
    undefined,
    (signal) => {
      seenSignal = signal;
      return new Promise<never>(() => {});
    },
  );
  await Bun.sleep(5);
  allowed = false;
  const started = Date.now();
  await expect(result).rejects.toBeInstanceOf(StageRevoked);
  expect(Date.now() - started).toBeLessThan(500);
  expect(seenSignal?.aborted).toBe(true);
});

it('discards a provider answer revoked before the next polling interval', async () => {
  let allowed = true;
  const result = withStageGuard(
    async () => allowed,
    undefined,
    async () => {
      allowed = false;
      return 'late';
    },
  );
  await expect(result).rejects.toBeInstanceOf(StageRevoked);
});

it('returns a current answer and preserves the original provider failure', async () => {
  expect(
    await withStageGuard(
      async () => true,
      undefined,
      async () => 'current',
    ),
  ).toBe('current');
  const failure = new Error('Synthetic provider failure');
  await expect(
    withStageGuard(
      async () => true,
      undefined,
      async () => {
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
});
