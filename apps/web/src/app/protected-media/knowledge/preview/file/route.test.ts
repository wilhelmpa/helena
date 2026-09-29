import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { GET } from './route';

const originalFetch = globalThis.fetch;
const originalOrigin = process.env.SERVICE_URL_API;
const url =
  'https://plan.test/protected-media/knowledge/preview/file?path=Projects%2FVOL%2FFiles%2FPlan.docx';

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOrigin === undefined) delete process.env.SERVICE_URL_API;
  else process.env.SERVICE_URL_API = originalOrigin;
});

describe('protected vault preview proxy', () => {
  it('needs a session cookie and a clean path before it contacts the API', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response();
    }) as typeof fetch;
    assert.equal((await GET(new Request(url))).status, 401);
    const noPath = new Request('https://plan.test/protected-media/knowledge/preview/file', {
      headers: { cookie: 'session=value' },
    });
    assert.equal((await GET(noPath)).status, 404);
    const control = new Request(`${url.split('?')[0]}?path=a%00b`, {
      headers: { cookie: 'session=value' },
    });
    assert.equal((await GET(control)).status, 404);
    assert.equal(called, false);
  });

  it('forwards the path, the session and a byte range to the one preview route', async () => {
    process.env.SERVICE_URL_API = 'http://api:3000';
    let capturedInput = '';
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedInput = String(input);
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response('pdf', {
        status: 206,
        headers: {
          'content-type': 'application/pdf',
          'content-range': 'bytes 0-2/3',
          'x-private': 'drop-me',
        },
      });
    }) as typeof fetch;
    const response = await GET(
      new Request(url, {
        headers: { cookie: 'session=value', range: 'bytes=0-2', authorization: 'drop-me' },
      }),
    );
    assert.equal(
      capturedInput,
      'http://api:3000/knowledge/preview/file?path=Projects%2FVOL%2FFiles%2FPlan.docx',
    );
    assert.deepEqual(capturedHeaders, { cookie: 'session=value', range: 'bytes=0-2' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 0-2/3');
    assert.equal(response.headers.get('x-private'), null);
  });
});
