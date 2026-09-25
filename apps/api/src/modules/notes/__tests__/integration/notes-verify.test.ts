import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { app } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { setEdgeKeyResolverForTests } from '#modules/edge-access/providers';
import { resetEdgeAccessCacheForTests } from '#modules/edge-access/service';
import { AUD, TEAM, testSigner } from '#modules/edge-access/__tests__/helpers';

const ORIGIN = 'http://localhost:3001';
const TUNNEL = { 'x-helena-entry': 'tunnel' };

function call(path: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return app.handle(new Request(`http://localhost${path}`, { ...init, headers }));
}
const verify = (headers: Record<string, string> = {}) => call('/auth/verify/notes', headers);

describe('the notes’ owner check (/auth/verify/notes)', () => {
  let sign: Awaited<ReturnType<typeof testSigner>>;
  beforeAll(async () => {
    sign = await testSigner();
  });
  afterAll(() => setEdgeKeyResolverForTests(null));
  beforeEach(async () => {
    await resetDb();
    resetEdgeAccessCacheForTests();
  });

  it('answers the owner’s session at home, and nobody else', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    const member = await signUpTestUser({ email: 'member@example.com' });
    expect((await verify()).status).toBe(401);
    expect((await verify({ cookie: 'better-auth.session_token=forged' })).status).toBe(401);
    const ok = await verify({ cookie: owner.cookie });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect((await verify({ cookie: member.cookie })).status).toBe(403);
  });

  it('never opens the notes to an API key, not even the owner’s', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    const key = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'cli' } });
    expect((await verify({ 'x-api-key': key.key })).status).toBe(403);
    expect((await verify({ cookie: owner.cookie, 'x-api-key': key.key })).status).toBe(403);
    expect((await verify({ authorization: `Bearer ${key.key}` })).status).toBe(403);
  });

  it('through the tunnel: a valid Access assertion naming the owner’s account', async () => {
    const owner = await signUpTestUser({ email: 'Owner@Example.com' });
    await signUpTestUser({ email: 'member@example.com' });
    // Nothing configured: every tunnel request is refused (the API's edge guard).
    expect((await verify({ ...TUNNEL, 'cf-access-jwt-assertion': await sign() })).status).toBe(403);
    const configured = await call(
      '/god/security/edge',
      { cookie: owner.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      {
        method: 'PUT',
        body: JSON.stringify({ teamDomain: TEAM, audiences: [AUD], allowedEmails: [] }),
      },
    );
    expect(configured.status).toBe(200);

    // The owner's e-mail (compared without case): in.
    expect((await verify({ ...TUNNEL, 'cf-access-jwt-assertion': await sign() })).status).toBe(204);
    // Another account, an unknown person, a service token without e-mail: out.
    for (const claims of [{ email: 'member@example.com' }, { email: 'stranger@example.com' }]) {
      const token = await sign(claims);
      expect((await verify({ ...TUNNEL, 'cf-access-jwt-assertion': token })).status).toBe(403);
    }
    expect(
      (await verify({ ...TUNNEL, 'cf-access-jwt-assertion': await sign({ email: undefined }) }))
        .status,
    ).toBe(403);
    // A forged or foreign assertion, or none: out. A Helena cookie does not stand in for it.
    expect((await verify({ ...TUNNEL, 'cf-access-jwt-assertion': 'x.y.z' })).status).toBe(403);
    expect(
      (
        await verify({
          ...TUNNEL,
          'cf-access-jwt-assertion': await sign({}, { audience: 'b'.repeat(64) }),
        })
      ).status,
    ).toBe(403);
    expect((await verify({ ...TUNNEL, cookie: owner.cookie })).status).toBe(403);
  });

  it('a deactivated owner is out, at home and through the tunnel', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    await call(
      '/god/security/edge',
      { cookie: owner.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      {
        method: 'PUT',
        body: JSON.stringify({ teamDomain: TEAM, audiences: [AUD], allowedEmails: [] }),
      },
    );
    const { db } = await import('@repo/db');
    const { user } = await import('@repo/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(user).set({ active: false }).where(eq(user.id, owner.userId));
    expect((await verify({ ...TUNNEL, 'cf-access-jwt-assertion': await sign() })).status).toBe(403);
    expect([401, 403]).toContain((await verify({ cookie: owner.cookie })).status);
  });
});

describe('the cross-site guard on the API', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('refuses a change a page of another origin makes with the owner’s cookie', async () => {
    const owner = await signUpTestUser();
    const body = JSON.stringify({ name: 'Von woanders', key: 'XS' });
    const fromNotes = await call(
      '/projects',
      { cookie: owner.cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-site' },
      { method: 'POST', body },
    );
    expect(fromNotes.status).toBe(403);
    expect(((await fromNotes.json()) as { code: string }).code).toBe('cross_site_refused');
    // Reading stays possible (CORS decides whether the page may see the answer).
    const read = await call('/me', { cookie: owner.cookie, 'sec-fetch-site': 'same-site' });
    expect(read.status).toBe(200);
    // Nor from the notes' own origin, which is not one of Helena's.
    const withOrigin = await call(
      '/projects',
      {
        cookie: owner.cookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-site',
        origin: 'http://localhost:8446',
      },
      { method: 'POST', body },
    );
    expect(withOrigin.status).toBe(403);
    // The web app on another origin of Helena's (APP_URL, here a second port) is.
    const fromWeb = await call(
      '/projects',
      {
        cookie: owner.cookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-site',
        origin: ORIGIN,
      },
      { method: 'POST', body },
    );
    expect(fromWeb.status).not.toBe(403);
    // Helena's own page is not affected.
    const own = await call(
      '/projects',
      { cookie: owner.cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      { method: 'POST', body },
    );
    expect(own.status).not.toBe(403);
  });
});
