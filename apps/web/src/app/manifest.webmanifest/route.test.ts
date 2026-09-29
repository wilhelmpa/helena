import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GET } from './route';

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_URL;
  else process.env.API_URL = originalApiUrl;
});

test('manifest reads the current display name on request', async () => {
  process.env.API_URL = 'http://127.0.0.1:3000';
  globalThis.fetch = (async () => Response.json({ displayName: 'Atlas' })) as typeof fetch;
  const response = await GET();
  const manifest = await response.json();
  assert.equal(manifest.name, 'Atlas');
  assert.equal(manifest.short_name, 'Atlas');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
