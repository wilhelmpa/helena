import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { desc, eq } from 'drizzle-orm';
import { pruneExpiredSessions, trustedOrigins } from '@repo/auth';
import { db } from '@repo/db';
import { helenaSignInEvent, session, user, aiAgent } from '@repo/db/schema';
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

  it('refuses unverified members, missing accounts and identities outside the allowlist', async () => {
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

  it('authenticates the verified member identity without promoting or creating accounts', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    const member = await signUpTestUser({ email: 'member@example.com' });
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, member.userId));
    await settings(owner.cookie, {
      teamDomain: TEAM,
      audiences: [AUD],
      allowedEmails: [owner.email, member.email],
      signIn: true,
    });
    const response = await signIn(await sign({ email: member.email }));
    expect(response.status).toBe(200);
    const memberAssertion = await sign({ email: member.email });
    const extraHeadersList: Record<string, string>[] = [
      {},
      { 'x-api-key': '' },
      { 'x-api-key': 'not-a-key' },
    ];
    for (const extraHeaders of extraHeadersList) {
      const mixed = await call('/me', {
        ...extraHeaders,
        cookie: owner.cookie,
        'x-helena-entry': 'tunnel',
        'cf-access-jwt-assertion': memberAssertion,
      });
      expect(mixed.status).toBe(401);
    }
    expect(
      (
        await call('/me', {
          cookie: member.cookie,
          'x-helena-entry': 'tunnel',
          'cf-access-jwt-assertion': memberAssertion,
        })
      ).status,
    ).toBe(200);
    const [event] = await events();
    expect(event).toMatchObject({ outcome: 'ok', userId: member.userId, identity: member.email });
    const [account] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, member.userId));
    expect(account?.role).toBe('user');
    await db.update(user).set({ active: false }).where(eq(user.id, member.userId));
    expect((await signIn(await sign({ email: member.email }))).status).toBe(403);
  });

  it('never authenticates an agent bot as a person', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    const member = await signUpTestUser({ email: 'bot@example.com' });
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, member.userId));
    const team = await call('/teams', { cookie: owner.cookie });
    const teams = (await team.json()) as { id: number }[];
    await db.insert(aiAgent).values({
      teamId: teams[0]!.id,
      userId: member.userId,
      username: 'fake-bot',
      kind: 'external',
    });
    await settings(owner.cookie, {
      teamDomain: TEAM,
      audiences: [AUD],
      allowedEmails: [member.email],
      signIn: true,
    });
    const response = await signIn(await sign({ email: member.email }));
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie().some((c) => c.includes('session_token='))).toBe(false);
  });

  it('refuses network-only owner login once another person exists, even with a legacy switch', async () => {
    await signUpTestUser({ email: 'owner@example.com' });
    await signUpTestUser({ email: 'member@example.com' });
    process.env.LOCAL_SINGLE_USER_EMAIL = 'owner@example.com';
    process.env.LOCAL_SINGLE_USER_TOKEN = PROOF;
    process.env.HELENA_LOCAL_SIGN_IN_MODE = 'single-user';
    try {
      const response = await call(
        '/api/auth/sign-in/local-owner',
        { origin: ORIGIN, 'x-volition-local-access': PROOF },
        { method: 'POST' },
      );
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie()).toEqual([]);
    } finally {
      delete process.env.LOCAL_SINGLE_USER_EMAIL;
      delete process.env.LOCAL_SINGLE_USER_TOKEN;
      delete process.env.HELENA_LOCAL_SIGN_IN_MODE;
    }
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
    process.env.HELENA_LOCAL_SIGN_IN_MODE = 'single-user';
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
      delete process.env.HELENA_LOCAL_SIGN_IN_MODE;
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

  it('lets a LAN session nobody uses expire within the hour, and keeps one that is used', async () => {
    const owner = await signUpTestUser({ email: 'owner@example.com' });
    const token = 'test-only-local-owner-token-'.padEnd(64, 'y');
    process.env.HELENA_LOCAL_SIGN_IN_MODE = 'single-user';
    process.env.LOCAL_SINGLE_USER_TOKEN = token;
    process.env.LOCAL_SINGLE_USER_EMAIL = 'owner@example.com';
    const lanSignIn = () =>
      call(
        '/api/auth/sign-in/local-owner',
        { 'x-volition-local-access': token, origin: ORIGIN, 'user-agent': 'lan-test' },
        { method: 'POST' },
      );
    try {
      const unused = await lanSignIn();
      const used = await lanSignIn();
      expect(unused.status).toBe(200);
      expect(used.status).toBe(200);
      const hour = Date.now() + 3600_000;
      const rows = await db
        .select({ token: session.token, expiresAt: session.expiresAt })
        .from(session)
        .where(eq(session.userId, owner.userId));
      const mine = rows.filter((row) => row.expiresAt.getTime() <= hour + 5_000);
      expect(mine).toHaveLength(2);

      // The browser that goes on: its first request extends the session to the full lifetime.
      const cookie = used.headers
        .getSetCookie()
        .find((value) => value.startsWith('better-auth.session_token='))!
        .split(';')[0]!;
      const current = await call('/api/auth/get-session', { cookie, origin: ORIGIN });
      expect(current.status).toBe(200);
      const after = await db
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(eq(session.userId, owner.userId));
      // The sign-up's session and the used one; the unused one still ends within the hour.
      const long = after.filter((row) => row.expiresAt.getTime() > Date.now() + 6 * 86_400_000);
      expect(long).toHaveLength(2);
      expect(after.filter((row) => row.expiresAt.getTime() <= hour + 5_000)).toHaveLength(1);

      // The janitor removes the unused one once it has expired, and nothing else.
      expect(await pruneExpiredSessions(new Date(hour + 60_000))).toBe(1);
      const left = await db
        .select({ expiresAt: session.expiresAt })
        .from(session)
        .where(eq(session.userId, owner.userId));
      expect(left.every((row) => row.expiresAt.getTime() > hour + 60_000)).toBe(true);
      expect(left).toHaveLength(2);
    } finally {
      delete process.env.HELENA_LOCAL_SIGN_IN_MODE;
      delete process.env.LOCAL_SINGLE_USER_TOKEN;
      delete process.env.LOCAL_SINGLE_USER_EMAIL;
    }
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

  it('allows the private network preflight of the probe to its own origins only', async () => {
    const preflight = (origin: string) =>
      call(
        '/edge/home/probe',
        {
          host: 'home.example.test',
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-private-network': 'true',
        },
        { method: 'OPTIONS' },
      );
    const own = await preflight(ORIGIN);
    expect(own.status).toBe(204);
    expect(own.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(own.headers.get('access-control-allow-private-network')).toBe('true');
    const foreign = await preflight('https://evil.example.test');
    expect(foreign.headers.get('access-control-allow-private-network')).toBeNull();
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });
});
