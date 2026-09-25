import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { desc, eq } from 'drizzle-orm';
import { trustedOrigins } from '@repo/auth';
import { db } from '@repo/db';
import { helenaSignInEvent, session } from '@repo/db/schema';
import { app } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { setEdgeKeyResolverForTests } from '../../providers';
import { resetEdgeAccessCacheForTests } from '../../service';
import { AUD, TEAM, testSigner } from '../helpers';

// The Cloudflare sign-in end to end through the app: the tunnel entry's proof, the Access
// assertion (a local key stands in for Cloudflare's), the switch, the allow list, the
// account, the session it opens and the trail it writes. Plus the home network's origin.

const ORIGIN = 'http://localhost:3001';
const PROOF = 'test-only-edge-entry-proof-'.padEnd(64, 'x');
const HOME = 'https://home.example.test';

function call(path: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return app.handle(new Request(`http://localhost${path}`, { ...init, headers }));
}

function settings(cookie: string, body: Record<string, unknown>) {
  return call(
    '/god/security/edge',
    { cookie, origin: ORIGIN, 'content-type': 'application/json' },
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

let address = 0;
// What the web app sends for a page load that came through the tunnel entry.
function signIn(assertion: string | null, extra: Record<string, string> = {}) {
  address += 1;
  return call(
    '/api/auth/sign-in/edge',
    {
      'x-helena-entry': 'tunnel',
      'x-helena-edge-entry': PROOF,
      origin: ORIGIN,
      'x-real-ip': `203.0.113.${address}`,
      'user-agent': 'edge-sign-in-test',
      ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}),
      ...extra,
    },
    { method: 'POST' },
  );
}

const events = () => db.select().from(helenaSignInEvent).orderBy(desc(helenaSignInEvent.id));

describe('the Cloudflare sign-in', () => {
  let sign: Awaited<ReturnType<typeof testSigner>>;
  beforeAll(async () => {
    sign = await testSigner();
    process.env.HELENA_EDGE_ENTRY_TOKEN = PROOF;
  });
  afterAll(() => {
    setEdgeKeyResolverForTests(null);
    delete process.env.HELENA_EDGE_ENTRY_TOKEN;
  });
  beforeEach(async () => {
    await resetDb();
    resetEdgeAccessCacheForTests();
  });

  it('does not exist without the tunnel entry proof, and leaves no trace', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    await settings(owner.cookie, {
      teamDomain: TEAM,
      audiences: [AUD],
      allowedEmails: ['owner@example.com'],
      signIn: true,
    });
    const token = await sign();
    for (const proof of ['', 'wrong', PROOF.slice(1)]) {
      const response = await signIn(token, { 'x-helena-edge-entry': proof });
      expect(response.status).toBe(404);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(await events()).toEqual([]);
  });

  it('is off until the owner turns it on, and needs an allow list for that', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    expect(
      (await settings(owner.cookie, { teamDomain: TEAM, audiences: [AUD], signIn: true })).status,
    ).toBe(400);
    expect(
      (await settings(owner.cookie, { signIn: true, allowedEmails: ['owner@example.com'] })).status,
    ).toBe(400);
    expect(
      (
        await settings(owner.cookie, {
          teamDomain: TEAM,
          audiences: [AUD],
          allowedEmails: ['owner@example.com'],
        })
      ).status,
    ).toBe(200);

    const off = await signIn(await sign());
    expect(off.status).toBe(403);
    expect(off.headers.getSetCookie()).toEqual([]);
    const [event] = await events();
    expect(event).toMatchObject({ method: 'edge', outcome: 'refused', reason: 'disabled' });
  });

  it('opens a day-long browser session for the owner and writes it down', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    await settings(owner.cookie, {
      teamDomain: TEAM,
      audiences: [AUD],
      allowedEmails: ['Owner@Example.com'],
      signIn: true,
    });
    const token = await sign({}, { expiresIn: '2h' });
    const response = await signIn(token);
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    const sessionCookie = cookies.find((cookie) => cookie.includes('session_token='));
    expect(sessionCookie).toBeDefined();
    // A browser-session cookie: no Max-Age, and better-auth does not extend the session.
    expect(sessionCookie).not.toMatch(/Max-Age/i);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const [row] = await db
      .select()
      .from(session)
      .where(eq(session.userId, owner.userId))
      .orderBy(desc(session.createdAt))
      .limit(1);
    const left = row!.expiresAt.valueOf() - Date.now();
    expect(left).toBeGreaterThan(110 * 60_000);
    expect(left).toBeLessThanOrEqual(2 * 3600_000 + 5000);
    expect(row!.ipAddress).toBe(`203.0.113.${address}`);

    const [event] = await events();
    expect(event).toMatchObject({
      method: 'edge',
      outcome: 'ok',
      userId: owner.userId,
      identity: 'owner@example.com',
      provider: 'cloudflare-access',
      ipAddress: `203.0.113.${address}`,
      userAgent: 'edge-sign-in-test',
    });

    // The session works through the tunnel (with the assertion, as every tunnel request).
    const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    const me = await call('/me', {
      'x-helena-entry': 'tunnel',
      'cf-access-jwt-assertion': token,
      cookie,
    });
    expect(((await me.json()) as { authenticated: boolean }).authenticated).toBe(true);
  });

  it('refuses an identity that is not the owner, has no account, or is not allowed', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    await signUpTestUser({ email: 'member@example.com' });
    await settings(owner.cookie, {
      teamDomain: TEAM,
      audiences: [AUD],
      allowedEmails: ['owner@example.com', 'member@example.com', 'ghost@example.com'],
      signIn: true,
    });

    const member = await signIn(await sign({ email: 'member@example.com' }));
    expect(member.status).toBe(403);
    const ghost = await signIn(await sign({ email: 'ghost@example.com' }));
    expect(ghost.status).toBe(403);
    // Not on the list: the api's edge guard refuses it before the sign-in runs.
    const stranger = await signIn(await sign({ email: 'stranger@example.com' }));
    expect(stranger.status).toBe(403);
    // No assertion, or a forged one: refused by the guard as well.
    expect((await signIn(null)).status).toBe(403);
    expect((await signIn('x.y.z')).status).toBe(403);
    for (const response of [member, ghost, stranger]) {
      expect(response.headers.getSetCookie().some((c) => c.includes('session_token='))).toBe(false);
    }

    const reasons = (await events()).map((event) => [event.identity, event.reason]);
    expect(reasons).toContainEqual(['member@example.com', 'not_eligible']);
    expect(reasons).toContainEqual(['ghost@example.com', 'no_account']);
  });

  it('lists the sign-ins for the owner only', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    const member = await signUpTestUser({ email: 'member@example.com' });
    await settings(owner.cookie, {
      teamDomain: TEAM,
      audiences: [AUD],
      allowedEmails: ['owner@example.com'],
      signIn: true,
    });
    expect((await signIn(await sign())).status).toBe(200);

    expect((await call('/god/security/sign-ins', { cookie: member.cookie })).status).toBe(403);
    const list = await call('/god/security/sign-ins?method=edge&limit=5', {
      cookie: owner.cookie,
    });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as { method: string; outcome: string; identity: string }[];
    expect(rows[0]).toMatchObject({
      method: 'edge',
      outcome: 'ok',
      identity: 'owner@example.com',
    });
  });

  it('writes the LAN owner sign-in to the same trail', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    const token = 'test-only-local-owner-token-'.padEnd(64, 'y');
    process.env.LOCAL_SINGLE_USER_TOKEN = token;
    process.env.LOCAL_SINGLE_USER_EMAIL = 'owner@example.com';
    try {
      const response = await call(
        '/api/auth/sign-in/local-owner',
        {
          'x-volition-local-access': token,
          origin: ORIGIN,
          'x-real-ip': '192.168.2.40',
          'user-agent': 'lan-test',
        },
        { method: 'POST' },
      );
      expect(response.status).toBe(200);
    } finally {
      delete process.env.LOCAL_SINGLE_USER_TOKEN;
      delete process.env.LOCAL_SINGLE_USER_EMAIL;
    }
    const [event] = await events();
    expect(event).toMatchObject({
      method: 'local_owner',
      outcome: 'ok',
      userId: owner.userId,
      ipAddress: '192.168.2.40',
      userAgent: 'lan-test',
    });
  });
});

describe('the home network origin', () => {
  beforeEach(async () => {
    await resetDb();
    resetEdgeAccessCacheForTests();
  });
  afterEach(() => {
    delete process.env.HELENA_HOME_URL;
    const at = trustedOrigins.indexOf(HOME);
    if (at >= 0) trustedOrigins.splice(at, 1);
  });

  it('is off without a home origin among the instance origins', async () => {
    expect(await (await call('/edge/home')).json()).toEqual({ homeUrl: null, autoConnect: false });
    // Named, but not one of the instance's origins (APP_URL): ignored.
    process.env.HELENA_HOME_URL = HOME;
    expect(await (await call('/edge/home')).json()).toEqual({ homeUrl: null, autoConnect: false });
  });

  it('switches at home unless the owner turned it off', async () => {
    const owner = await signUpTestUser();
    process.env.HELENA_HOME_URL = `${HOME}/`;
    trustedOrigins.push(HOME);
    expect(await (await call('/edge/home')).json()).toEqual({ homeUrl: HOME, autoConnect: true });

    expect((await settings(owner.cookie, { homeAutoConnect: false })).status).toBe(200);
    expect(await (await call('/edge/home')).json()).toEqual({ homeUrl: HOME, autoConnect: false });
    const read = (await (await call('/god/security/edge', { cookie: owner.cookie })).json()) as {
      homeUrl: string;
      homeAutoConnect: boolean;
    };
    expect(read).toMatchObject({ homeUrl: HOME, homeAutoConnect: false });
  });

  it('answers the probe from the home network, never through the tunnel', async () => {
    const probe = await call('/edge/home/probe', { host: 'home.example.test' });
    expect(await probe.json()).toEqual({ home: true, host: 'home.example.test' });
    expect(probe.headers.get('cache-control')).toBe('no-store');
    // Through the tunnel entry the edge guard answers first.
    expect((await call('/edge/home/probe', { 'x-helena-entry': 'tunnel' })).status).toBe(403);
  });
});
