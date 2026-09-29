import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { updateOwnerTerminalSettings } from './owner-terminal';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('sends the terminal sudo switch to the owner policy endpoint', async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), init: init! };
    return Response.json({ sudoWithoutPassword: false });
  };

  const result = await updateOwnerTerminalSettings({ sudoWithoutPassword: false });
  const request = sent as { url: string; init: RequestInit } | undefined;
  assert.ok(request);
  assert.equal(result.sudoWithoutPassword, false);
  assert.ok(request.url.endsWith('/owner-terminal/settings'));
  assert.equal(request.init.method, 'PATCH');
  assert.equal(request.init.credentials, 'include');
  assert.deepEqual(JSON.parse(String(request.init.body)), { sudoWithoutPassword: false });
});
