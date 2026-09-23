import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { fileQuery, forwardFile } from './forward';

const originalFetch = globalThis.fetch;
const originalOrigin = process.env.SERVICE_URL_API;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOrigin === undefined) delete process.env.SERVICE_URL_API;
  else process.env.SERVICE_URL_API = originalOrigin;
});

describe('fileQuery', () => {
  const query = (search: string) =>
    fileQuery(new Request(`https://plan.test/x?${search}`), ['vault', 'code']);

  it('passes on the root, the path and the download switch only', () => {
    assert.equal(
      query('root=vault&path=a%2Fb.pdf&download=1&other=x'),
      'root=vault&path=a%2Fb.pdf&download=1',
    );
  });

  it('refuses an unknown root or a missing path', () => {
    assert.equal(query('root=private&path=a.pdf'), null);
    assert.equal(query('root=vault'), null);
  });
});

describe('forwardFile', () => {
  it('requires a session before contacting the API', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response();
    }) as typeof fetch;
    const response = await forwardFile(
      new Request('https://plan.test/x'),
      '/files/raw?root=home&path=a',
    );
    assert.equal(response.status, 401);
    assert.equal(called, false);
  });

  it('forwards the session and a byte range, and returns the partial file', async () => {
    process.env.SERVICE_URL_API = 'http://api:3000';
    let captured: RequestInit | undefined;
    let url = '';
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input);
      captured = init;
      return new Response('PDF', {
        status: 206,
        headers: {
          'content-type': 'application/pdf',
          'content-range': 'bytes 1-3/8',
          'x-internal': 'drop-me',
        },
      });
    }) as typeof fetch;
    const response = await forwardFile(
      new Request('https://plan.test/x', {
        headers: { cookie: 'session=1', range: 'bytes=1-3', authorization: 'drop-me' },
      }),
      '/projects/VOL/files/raw?root=vault&path=a.pdf',
    );
    assert.equal(url, 'http://api:3000/projects/VOL/files/raw?root=vault&path=a.pdf');
    assert.deepEqual(captured?.headers, { cookie: 'session=1', range: 'bytes=1-3' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 1-3/8');
    assert.equal(response.headers.get('x-internal'), null);
  });
});
