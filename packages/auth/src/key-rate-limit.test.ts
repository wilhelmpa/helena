import { afterAll, describe, expect, it } from 'bun:test';
import { consumeKeyRequest, RateLimitedError, resetKeyRateLimitForTests } from './key-rate-limit';

// The API key limit counts fixed one-second windows: a client that stays under the
// ceiling is never refused, however long it keeps calling, and one that bursts past it is
// told how long to wait.

afterAll(() => resetKeyRateLimitForTests());

describe('API key request limit', () => {
  it('never locks out a client that calls steadily under the limit', async () => {
    resetKeyRateLimitForTests(20);
    // 12 requests a second for 2.5 seconds: 30 in all, more than the ceiling of one
    // window. The plugin's own counter refused the 21st and never let the key back in.
    for (let i = 0; i < 30; i++) {
      await consumeKeyRequest('itp_steady');
      await Bun.sleep(1000 / 12);
    }
  });

  it('refuses a burst past the limit with the seconds to wait, then lets it in again', async () => {
    resetKeyRateLimitForTests(5);
    for (let i = 0; i < 5; i++) await consumeKeyRequest('itp_burst');
    const refused = await consumeKeyRequest('itp_burst').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RateLimitedError);
    expect((refused as RateLimitedError).retryAfterSeconds).toBe(1);
    // Another key has its own count.
    await consumeKeyRequest('itp_other');
    await Bun.sleep(1050);
    await consumeKeyRequest('itp_burst');
  });
});
