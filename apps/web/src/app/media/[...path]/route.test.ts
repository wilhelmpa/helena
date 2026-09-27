import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { GET } from './route';
const original = globalThis.fetch;
const originalOrigin = process.env.SERVICE_URL_API;
afterEach(() => {
  globalThis.fetch = original;
  if (originalOrigin === undefined) delete process.env.SERVICE_URL_API;
  else process.env.SERVICE_URL_API = originalOrigin;
});
const id = '12345678-1234-1234-1234-123456789abc';
it('keeps legacy attachment embeds authenticated, bounded and out of shared caches', async () => {
  process.env.SERVICE_URL_API = 'http://api.test';
  let calls = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), `http://api.test/chat-attachments/${id}/raw?download=1`);
    assert.equal(new Headers(init?.headers).get('cookie'), 'session=fixture');
    assert.equal(init?.redirect, 'error');
    return new Response('fixture', { headers: { 'cache-control': 'public, max-age=3600' } });
  }) as typeof fetch;
  const params = Promise.resolve({ path: ['chat-attachments', id, 'raw'] });
  assert.equal((await GET(new Request('https://helena.test/media/x'), { params })).status, 401);
  assert.equal(calls, 0);
  const request = new Request('https://helena.test/media/x?download=1&other=drop', {
    headers: { cookie: 'session=fixture' },
  });
  const result = await GET(request, { params });
  assert.equal(await result.text(), 'fixture');
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('vary'), 'Cookie');
  for (const path of [
    ['chat-attachments', id],
    ['attachments', 'users', 'raw'],
    ['attachments', id, 'raw', 'extra'],
  ]) {
    assert.equal((await GET(request, { params: Promise.resolve({ path }) })).status, 404);
  }
  assert.equal(calls, 1);
});
