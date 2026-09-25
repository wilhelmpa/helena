// Equal-jitter exponential backoff, as the worker's (apps/worker/src/backoff.ts): half of
// the window fixed, half random, so a push service that recovers is not hit all at once.
export function pushBackoffMs(attempts: number, baseMs = 30_000, capMs = 30 * 60_000): number {
  const window = Math.min(capMs, baseMs * 2 ** Math.max(0, attempts - 1));
  const half = window / 2;
  return Math.floor(half + Math.random() * half);
}
