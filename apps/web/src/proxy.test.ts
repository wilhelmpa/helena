import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const COOKIE = 'better-auth.session_token=stale.signature';

let originalApiUrl: string | undefined;

beforeEach(() => {
  originalApiUrl = process.env.API_URL;
});

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.API_URL;
  else process.env.API_URL = originalApiUrl;
});

function run(path: string, cookie?: string) {
  return proxy(
    new NextRequest(`http://localhost${path}`, {
      headers: cookie ? { cookie } : undefined,
    }),
  );
}

describe('proxy', () => {
  it('keeps a stale session on the expired screen instead of bouncing it back', async () => {
    const res = await run('/login?expired=1', COOKIE);
    assert.equal(res.headers.get('location'), null);
  });

  it('expires the stale cookies the api could not clear', async () => {
    const res = await run(
      '/login?expired=1',
      `${COOKIE}; __Secure-better-auth.session_data=cached`,
    );
    const cleared = res.headers.getSetCookie();
    assert.equal(cleared.length, 2);
    assert.match(cleared[0]!, /^better-auth\.session_token=;/);
    assert.match(cleared[0]!, /Expires=Thu, 01 Jan 1970/);
    // A `__Secure-` cookie is only accepted back with the attribute its name demands.
    assert.match(cleared[1]!, /^__Secure-better-auth\.session_data=;/);
    assert.match(cleared[1]!, /Secure/);
  });

  it('sends a signed-in user away from the login page', async () => {
    const res = await run('/login', COOKIE);
    assert.equal(res.headers.get('location'), 'http://localhost/');
  });

  it('sends a visitor without a session to the login page', async () => {
    const res = await run('/', undefined);
    assert.equal(res.headers.get('location'), 'http://localhost/login?callbackURL=%2F');
  });

  it('does not auto-login a visitor when legacy auto-login variables are present', async () => {
    process.env.LOCAL_AUTO_LOGIN = 'true';
    process.env.LOCAL_AUTO_LOGIN_HOSTS = 'localhost';
    process.env.LOCAL_AUTO_LOGIN_EMAIL = 'legacy@example.test';
    process.env.LOCAL_AUTO_LOGIN_PASSWORD = 'unused';
    const res = await run('/', undefined);
    assert.equal(res.headers.get('location'), 'http://localhost/login?callbackURL=%2F');
    assert.equal(res.headers.getSetCookie().length, 0);
    delete process.env.LOCAL_AUTO_LOGIN;
    delete process.env.LOCAL_AUTO_LOGIN_HOSTS;
    delete process.env.LOCAL_AUTO_LOGIN_EMAIL;
    delete process.env.LOCAL_AUTO_LOGIN_PASSWORD;
  });

  it('keeps the protected destination through sign-in', async () => {
    const res = await run('/project/VERV?view=board', undefined);
    assert.equal(
      res.headers.get('location'),
      'http://localhost/login?callbackURL=%2Fproject%2FVERV%3Fview%3Dboard',
    );
  });
});

describe('proxy security headers', () => {
  it('serves every page with a content security policy naming the api origin', async () => {
    process.env.API_URL = 'http://api.test:3000/';
    const csp = (await run('/login')).headers.get('content-security-policy');
    assert.match(csp!, /(^|; )connect-src 'self' http:\/\/api\.test:3000(;|$)/);
    assert.match(csp!, /(^|; )frame-ancestors 'none'(;|$)/);
    assert.match(csp!, /(^|; )object-src 'none'(;|$)/);
  });

  it('runs scripts by a fresh nonce per request and hands it to the page', async () => {
    const first = await run('/login');
    const second = await run('/login');
    const nonceOf = (res: Response) =>
      /script-src 'nonce-([^']+)' 'strict-dynamic'/.exec(
        res.headers.get('content-security-policy') ?? '',
      )?.[1];
    const nonce = nonceOf(first);
    assert.ok(nonce);
    assert.notEqual(nonce, nonceOf(second));
    // Next reads the nonce from the policy on the request; the layout reads x-nonce.
    assert.equal(first.headers.get('x-middleware-request-x-nonce'), nonce);
    assert.match(
      first.headers.get('x-middleware-request-content-security-policy') ?? '',
      new RegExp(`'nonce-${nonce}'`),
    );
  });

  it('keeps the policy on a redirect and on the expired screen', async () => {
    assert.ok((await run('/', undefined)).headers.get('content-security-policy'));
    assert.ok((await run('/login?expired=1', COOKIE)).headers.get('content-security-policy'));
  });

  it('leaves the media routes to the headers the api sends', async () => {
    assert.equal(
      (await run('/media/avatars/u1', COOKIE)).headers.get('content-security-policy'),
      null,
    );
    const document = '/protected-media/projects/KEY/documents/1/assets/x/raw';
    assert.equal((await run(document, COOKIE)).headers.get('content-security-policy'), null);
  });
});
