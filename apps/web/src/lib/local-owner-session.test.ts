import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { localOwnerSession } from './local-owner-session';

const token = 'test-only-local-owner-token-1234567890';
const names = [
  'HELENA_LOCAL_SIGN_IN_MODE',
  'LOCAL_SINGLE_USER_TOKEN',
  'LOCAL_SINGLE_USER_ORIGIN',
  'LOCAL_SINGLE_USER_API_URL',
] as const;
let previous: (string | undefined)[];
const originalFetch = globalThis.fetch;
let calls = 0;
beforeEach(() => {
  previous = names.map((name) => process.env[name]);
  process.env.LOCAL_SINGLE_USER_TOKEN = token;
  process.env.LOCAL_SINGLE_USER_ORIGIN = 'http://kingston-server.local';
  process.env.LOCAL_SINGLE_USER_API_URL = 'http://127.0.0.1:3000/api/auth/sign-in/local-owner';
  process.env.HELENA_LOCAL_SIGN_IN_MODE = 'single-user';
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('{}', {
      headers: {
        'set-cookie': 'better-auth.session_token=new.signature; Path=/; HttpOnly; SameSite=Lax',
      },
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  names.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name];
    else process.env[name] = previous[index];
  });
});
function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://kingston-server.local${path}`, {
    headers: { host: 'kingston-server.local', 'x-volition-local-access': token, ...headers },
  });
}
describe('local session bootstrap', () => {
  it('sets a normal session and preserves the requested project', async () => {
    const response = await localOwnerSession(request('/project/VOL?view=board'));
    assert.equal(
      response?.headers.get('location'),
      'http://kingston-server.local/project/VOL?view=board',
    );
    assert.match(response!.headers.getSetCookie()[0]!, /HttpOnly/);
    assert.equal(response?.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 1);
  });
  it('honors a local login callback and rejects external redirect targets', async () => {
    const response = await localOwnerSession(
      request('/login?expired=1&callbackURL=%2Fproject%2FVOL'),
    );
    assert.equal(response?.headers.get('location'), 'http://kingston-server.local/project/VOL');
    for (const target of [
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      '/login',
      '/register',
    ]) {
      const blocked = await localOwnerSession(
        request('/login?callbackURL=' + encodeURIComponent(target)),
      );
      assert.equal(blocked?.headers.get('location'), 'http://kingston-server.local/');
    }
  });
  it('does not accept a missing capability, public hostname, or cross-origin request', async () => {
    const rejectedHeaders: Record<string, string>[] = [
      { 'x-volition-local-access': '' },
      { 'x-volition-local-access': 'invalid' },
      { host: 'plan.volition.one' },
      { origin: 'https://evil.test' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of rejectedHeaders)
      assert.equal(await localOwnerSession(request('/', headers)), null);
    assert.equal(calls, 0);
  });
  it('fails closed when the backend rejects or does not return a session', async () => {
    for (const response of [new Response('{}', { status: 403 }), new Response('{}')]) {
      globalThis.fetch = (async () => response) as typeof fetch;
      assert.equal(await localOwnerSession(request('/login')), null);
    }
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    assert.equal(await localOwnerSession(request('/login')), null);
  });
  it('does not mint an owner session in personal mode, even after choosing a person', async () => {
    for (const mode of ['personal', '', undefined]) {
      if (mode === undefined) delete process.env.HELENA_LOCAL_SIGN_IN_MODE;
      else process.env.HELENA_LOCAL_SIGN_IN_MODE = mode;
      assert.equal(await localOwnerSession(request('/login?person=owner&continue=1')), null);
    }
    assert.equal(calls, 0);
  });
  it('is disabled without explicit configuration', async () => {
    delete process.env.LOCAL_SINGLE_USER_TOKEN;
    assert.equal(await localOwnerSession(request('/')), null);
    assert.equal(calls, 0);
  });
});
