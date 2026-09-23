import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { GET } from './route';

const originalFetch = globalThis.fetch;
const originalOrigin = process.env.SERVICE_URL_API;
const url =
  'https://plan.test/protected-media/knowledge/raw?path=Projects%2FVOL%2FAssets%2Fa+b.png';

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOrigin === undefined) delete process.env.SERVICE_URL_API;
  else process.env.SERVICE_URL_API = originalOrigin;
});

describe('protected vault file proxy', () => {
  it('requires a path and a session cookie before contacting the API', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response();
    }) as typeof fetch;
    assert.equal((await GET(new Request(url))).status, 401);
    const noPath = new Request('https://plan.test/protected-media/knowledge/raw', {
      headers: { cookie: 'session=value' },
    });
    assert.equal((await GET(noPath)).status, 404);
    assert.equal(called, false);
  });

  it('forwards only the session and cache validator to the raw file endpoint', async () => {
    process.env.SERVICE_URL_API = 'http://api:3000';
    let capturedInput = '';
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedInput = String(input);
      capturedInit = init;
      return new Response('image', {
        headers: { 'content-type': 'image/png', etag: 'v1', 'x-private': 'drop-me' },
      });
    }) as typeof fetch;
    const response = await GET(
      new Request(url, {
        headers: { cookie: 'session=value', 'if-none-match': 'v0', authorization: 'drop-me' },
      }),
    );
    assert.equal(
      capturedInput,
      'http://api:3000/knowledge/raw?path=Projects%2FVOL%2FAssets%2Fa+b.png',
    );
    assert.deepEqual(capturedInit?.headers, { cookie: 'session=value', 'if-none-match': 'v0' });
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-private'), null);
  });
});
