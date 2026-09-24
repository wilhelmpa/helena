import { createHash } from 'node:crypto';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';

// The request limit of a personal or agent API key: API_KEY_RATE_LIMIT requests per second
// (default 100) in fixed one-second windows, counted in this process with
// rate-limiter-flexible. It replaces the api-key plugin's own counter, which starts a new
// window only after a full quiet second: a client calling steadily was locked out after its
// first hundred requests and never let back in. A key is counted by its hash, never by its
// value. The API runs as one process, so memory is the whole count.

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests');
    this.name = 'RateLimitedError';
  }
}

let limiter: RateLimiterMemory | null = null;

function keyLimiter(): RateLimiterMemory {
  if (!limiter) {
    const points = Number(process.env.API_KEY_RATE_LIMIT ?? 100);
    limiter = new RateLimiterMemory({
      points: Number.isFinite(points) && points > 0 ? points : 100,
      duration: 1,
    });
  }
  return limiter;
}

// For tests: a limiter with another ceiling, or the default again.
export function resetKeyRateLimitForTests(points?: number): void {
  limiter = points === undefined ? null : new RateLimiterMemory({ points, duration: 1 });
}

export async function consumeKeyRequest(key: string): Promise<void> {
  const id = createHash('sha256').update(key).digest('base64url');
  try {
    await keyLimiter().consume(id);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      throw new RateLimitedError(Math.max(1, Math.ceil(error.msBeforeNext / 1000)));
    }
    throw error;
  }
}
