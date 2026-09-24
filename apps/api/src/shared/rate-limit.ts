import type { RateLimitedError } from '@repo/auth';

// The answer to a request over its API key's limit: 429 with the seconds to wait.
export function tooManyRequests(error: RateLimitedError): Response {
  return Response.json(
    { error: 'Too many requests', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'retry-after': String(error.retryAfterSeconds) } },
  );
}
