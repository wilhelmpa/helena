import { describe, expect, it, mock } from 'bun:test';
import { PlanApiError, PlanClient } from './plan-client';

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  return mock((input: string | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {})),
  );
}

describe('PlanClient', () => {
  it('sends the service token as a bearer header on every call', async () => {
    const fetchImpl = fakeFetch(
      () => new Response(JSON.stringify({ code: '123456', secondsRemaining: 20 })),
    );
    const client = new PlanClient({
      baseUrl: 'http://127.0.0.1:3000',
      serviceToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.loginCode('agent-key', 5);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('parses a login result', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            status: 'filled',
            login: { id: 1, label: 'x', username: 'u', password: 'p', has2fa: false },
          }),
        ),
    );
    const client = new PlanClient({
      baseUrl: 'http://127.0.0.1:3000',
      serviceToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client.login('agent-key', 'MKT', 'https://example.com');
    expect(result.status).toBe('filled');
  });

  it('throws PlanApiError with the status and message on a non-2xx response', async () => {
    const fetchImpl = fakeFetch(
      () => new Response(JSON.stringify({ error: 'nope' }), { status: 403 }),
    );
    const client = new PlanClient({
      baseUrl: 'http://127.0.0.1:3000',
      serviceToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.resolve('agent-key', 'MKT')).rejects.toThrow(PlanApiError);
    try {
      await client.resolve('agent-key', 'MKT');
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanApiError);
      expect((error as PlanApiError).status).toBe(403);
      expect((error as PlanApiError).message).toBe('nope');
    }
  });

  it('trims a trailing slash from the base URL', async () => {
    const fetchImpl = fakeFetch(() => new Response('{"projects":{}}'));
    const client = new PlanClient({
      baseUrl: 'http://127.0.0.1:3000/',
      serviceToken: 'tok',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.policy();
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3000/internal/browser-gateway/policy');
  });
});
