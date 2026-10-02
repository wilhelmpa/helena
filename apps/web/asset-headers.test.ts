import assert from 'node:assert/strict';
import { it } from 'node:test';
import config from './next.config';

it('serves workers with explicit MIME, scope and cache headers', async () => {
  const rules = await config.headers!();
  const headers = (path: string) =>
    Object.fromEntries(
      rules
        .find((rule) => rule.source === path)!
        .headers.map((header) => [header.key, header.value]),
    );
  assert.equal(headers('/sw.js')['Service-Worker-Allowed'], '/');
  assert.equal(headers('/sw.js')['Cache-Control'], 'no-cache');
  assert.match(headers('/sw.js')['Content-Type'], /javascript/);
  assert.match(headers('/voice/:path*')['Cache-Control'], /no-cache/);
  assert.match(headers('/voice/:file(.*\\.m?js)')['Content-Type'], /javascript/);
  assert.equal(headers('/voice/:file(.*\\.wasm)')['Content-Type'], 'application/wasm');
});
