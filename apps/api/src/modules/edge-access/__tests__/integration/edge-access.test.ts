import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auth } from '@repo/auth';
import { app } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { setOwnerTerminalSettings } from '#modules/owner-terminal/service';
import { setEdgeKeyResolverForTests } from '../../providers';
import { setLanOnlineVerifierForTests } from '../../lan';
import { resetEdgeAccessCacheForTests } from '../../service';
import { AUD, TEAM, testSigner } from '../helpers';

const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'edge-access-'));
const keyFile = join(work, 'owner-terminal.key');
writeFileSync(keyFile, randomBytes(32).toString('hex'));
process.env.OWNER_TERMINAL_KEY_PATH = keyFile;
const auditPath = join(work, 'audit.json');
process.env.HELENA_SECURITY_AUDIT_FILE = auditPath;

const ORIGIN = 'http://localhost:3001';
const TUNNEL = { 'x-helena-entry': 'tunnel' };

function call(path: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return app.handle(new Request(`http://localhost${path}`, { ...init, headers }));
}

async function configure(cookie: string) {
  return call(
    '/god/security/edge',
    { cookie, origin: ORIGIN, 'content-type': 'application/json' },
    {
      method: 'PUT',
      body: JSON.stringify({ teamDomain: TEAM, audiences: [AUD], allowedEmails: [] }),
    },
  );
}

describe('edge access (the internet tunnel entry)', () => {
  let sign: Awaited<ReturnType<typeof testSigner>>;
  beforeAll(async () => {
    sign = await testSigner();
  });
  afterAll(() => {
    setEdgeKeyResolverForTests(null);
    setLanOnlineVerifierForTests(null);
  });
  beforeEach(async () => {
    await resetDb();
    resetEdgeAccessCacheForTests();
    setLanOnlineVerifierForTests(null);
  });

  it('refuses every tunnel request while nothing is configured', async () => {
    const owner = await signUpTestUser();
    for (const path of ['/me', '/projects', '/api/auth/get-session', '/auth/verify']) {
      const response = await call(path, { ...TUNNEL, cookie: owner.cookie });
      expect(response.status).toBe(403);
    }
    const body = (await (await call('/me', TUNNEL)).json()) as { code: string };
    expect(body.code).toBe('edge_not_configured');
  });

  it('returns shared, non-cacheable errors for cross-site cookie writes', async () => {
    const owner = await signUpTestUser();
    const response = await call(
      '/projects',
      {
        cookie: owner.cookie,
        origin: 'https://other.example.com',
        'sec-fetch-site': 'same-site',
      },
      { method: 'POST' },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ code: 'cross_site_refused' });
  });

  it('lets a tunnel request through only with a valid assertion', async () => {
    const owner = await signUpTestUser();
    expect((await configure(owner.cookie)).status).toBe(200);

    const without = await call('/me', { ...TUNNEL, cookie: owner.cookie });
    expect(without.status).toBe(403);
    const forged = await call('/me', {
      ...TUNNEL,
      cookie: owner.cookie,
      'cf-access-jwt-assertion': 'x.y.z',
    });
    expect(forged.status).toBe(403);

    const signed = await call('/me', {
      ...TUNNEL,
      cookie: owner.cookie,
      'cf-access-jwt-assertion': await sign(),
    });
    expect(signed.status).toBe(200);
    expect(((await signed.json()) as { authenticated: boolean }).authenticated).toBe(true);

    // The LAN entry is unchanged: no marker, no assertion needed.
    expect((await call('/me', { cookie: owner.cookie })).status).toBe(200);
  });

  it('answers nginx on /auth/verify/edge, and never for a request without the marker', async () => {
    const owner = await signUpTestUser();
    await configure(owner.cookie);
    const token = await sign();
    expect((await call('/auth/verify/edge', { 'cf-access-jwt-assertion': token })).status).toBe(
      403,
    );
    const ok = await call('/auth/verify/edge', { ...TUNNEL, 'cf-access-jwt-assertion': token });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('x-helena-edge-email')).toBe('owner@example.com');
    expect((await call('/auth/verify/edge', TUNNEL)).status).toBe(403);
  });

  it('holds the settings to the owner’s interactive session and validates them', async () => {
    const owner = await signUpTestUser();
    const other = await signUpTestUser({ email: 'member@example.com' });
    expect((await configure(other.cookie)).status).toBe(403);

    const bad = await call(
      '/god/security/edge',
      { cookie: owner.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      { method: 'PUT', body: JSON.stringify({ teamDomain: 'evil.example.com', audiences: [AUD] }) },
    );
    expect(bad.status).toBe(400);

    const key = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'cli' } });
    const withKey = await call(
      '/god/security/edge',
      { 'x-api-key': key.key, origin: ORIGIN, 'content-type': 'application/json' },
      { method: 'PUT', body: JSON.stringify({ teamDomain: TEAM, audiences: [AUD] }) },
    );
    expect(withKey.status).toBe(403);

    expect((await configure(owner.cookie)).status).toBe(200);
    const read = await call('/god/security/edge', { cookie: owner.cookie });
    expect(await read.json()).toMatchObject({
      teamDomain: TEAM,
      audiences: [AUD],
      configured: true,
    });
  });

  it('never counts a tunnel request as the LAN for the owner terminal', async () => {
    const owner = await signUpTestUser();
    await configure(owner.cookie);
    await setOwnerTerminalSettings({ stepUpRequired: false });
    const lan = { cookie: owner.cookie, 'x-real-ip': '192.168.2.40' };
    expect((await call('/auth/verify/owner-terminal/shell', lan)).status).toBe(204);
    const viaTunnel = await call('/auth/verify/owner-terminal/shell', {
      ...lan,
      ...TUNNEL,
      'cf-access-jwt-assertion': await sign(),
    });
    expect(viaTunnel.status).toBe(403);
  });

  it('requires both Access gates on every strict LAN request, even with a Helena session', async () => {
    const owner = await signUpTestUser();
    await configure(owner.cookie);
    const assertion = await sign();
    const headers = {
      'x-helena-entry': 'lan',
      cookie: `${owner.cookie}; CF_Authorization=${assertion}; CF_Binding=binding`,
    };
    const onlineCookies: string[] = [];
    let allowed = true;
    setLanOnlineVerifierForTests(async (cookies) => {
      onlineCookies.push(cookies);
      return allowed;
    });
    expect((await call('/auth/verify/lan', headers)).status).toBe(204);
    expect((await call('/me', headers)).status).toBe(200);
    expect(onlineCookies).toEqual([
      `CF_Authorization=${assertion}; CF_Binding=binding`,
      `CF_Authorization=${assertion}; CF_Binding=binding`,
    ]);
    allowed = false;
    for (const path of ['/auth/verify/lan', '/me', '/projects', '/auth/verify']) {
      expect((await call(path, headers)).status).toBe(403);
    }
    expect(onlineCookies).toHaveLength(6); // no positive authorization cache
  });

  it('rejects malformed, conflicting and forged LAN credentials before the public check', async () => {
    const owner = await signUpTestUser();
    await configure(owner.cookie);
    const assertion = await sign();
    let calls = 0;
    setLanOnlineVerifierForTests(async () => {
      calls++;
      return true;
    });
    const base = { 'x-helena-entry': 'lan', cookie: owner.cookie };
    const invalid = [
      base,
      { ...base, cookie: `${owner.cookie}; CF_Authorization=${assertion}` },
      { ...base, cookie: `${owner.cookie}; CF_Authorization=x.y.z; CF_Binding=b` },
      {
        ...base,
        cookie: `${owner.cookie}; CF_Authorization=${assertion}; CF_Binding=b; CF_Binding=c`,
      },
      {
        ...base,
        cookie: `${owner.cookie}; CF_Authorization=${assertion}; cf_authorization=x.y.z; CF_Binding=b`,
      },
      {
        ...base,
        cookie: `${owner.cookie}; CF_Authorization=${assertion}; CF_Binding=b; x=${'a'.repeat(8192)}`,
      },
      {
        ...base,
        cookie: `${owner.cookie}; CF_Authorization=${await sign({}, { expiresIn: '-1h' })}; CF_Binding=b`,
      },
      {
        ...base,
        cookie: `${owner.cookie}; CF_Authorization=${await sign({}, { issuer: 'https://other.cloudflareaccess.com' })}; CF_Binding=b`,
      },
      {
        ...base,
        cookie: `${owner.cookie}; CF_Authorization=${await sign({}, { audience: 'b'.repeat(64) })}; CF_Binding=b`,
      },
    ];
    for (const headers of invalid) {
      expect(
        (
          await call('/me', {
            ...headers,
            'cf-access-jwt-assertion': assertion,
            'x-helena-edge-entry': 'forged',
            'x-volition-local-access': 'forged',
            'cf-connecting-ip': '192.168.2.40',
          })
        ).status,
      ).toBe(403);
    }
    expect(calls).toBe(0);
  });

  it('closes a valid LAN session when the public check times out', async () => {
    const owner = await signUpTestUser();
    await configure(owner.cookie);
    setLanOnlineVerifierForTests(async () => {
      throw new Error('timeout');
    });
    const response = await call('/me', {
      'x-helena-entry': 'lan',
      cookie: `${owner.cookie}; CF_Authorization=${await sign()}; CF_Binding=binding`,
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('gives a checked LAN browser the Access expiry for stream reload', async () => {
    const owner = await signUpTestUser();
    await configure(owner.cookie);
    setLanOnlineVerifierForTests(async () => true);
    const response = await call('/auth/verify/lan', {
      'x-helena-entry': 'lan',
      cookie: `${owner.cookie}; CF_Authorization=${await sign()}; CF_Binding=binding`,
    });
    expect(response.status).toBe(204);
    expect(Number(response.headers.get('x-helena-access-expires'))).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
  });

  it('keeps Helena session and owner-terminal checks after valid LAN Access', async () => {
    const owner = await signUpTestUser();
    await configure(owner.cookie);
    await setOwnerTerminalSettings({ stepUpRequired: false });
    setLanOnlineVerifierForTests(async () => true);
    const access = `CF_Authorization=${await sign()}; CF_Binding=binding`;
    expect((await call('/auth/verify', { 'x-helena-entry': 'lan', cookie: access })).status).toBe(
      401,
    );
    expect(
      (
        await call('/auth/verify', {
          'x-helena-entry': 'lan',
          cookie: `${owner.cookie}; ${access}`,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call('/auth/verify/owner-terminal/shell', {
          'x-helena-entry': 'lan',
          cookie: `${owner.cookie}; ${access}`,
          'x-real-ip': '192.168.2.40',
        })
      ).status,
    ).toBe(403);
  });

  it('keeps project membership checks after valid LAN Access', async () => {
    const owner = await signUpTestUser();
    await configure(owner.cookie);
    const created = await call(
      '/projects',
      {
        cookie: owner.cookie,
        origin: ORIGIN,
        'content-type': 'application/json',
      },
      { method: 'POST', body: JSON.stringify({ key: 'MKT', name: 'Marketing' }) },
    );
    expect(created.status).toBe(201);
    const outsider = await signUpTestUser({ email: 'outsider@example.com' });
    setLanOnlineVerifierForTests(async () => true);
    const access = `CF_Authorization=${await sign()}; CF_Binding=binding`;
    expect(
      (
        await call('/projects/MKT', {
          'x-helena-entry': 'lan',
          cookie: `${owner.cookie}; ${access}`,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('/projects/MKT', {
          'x-helena-entry': 'lan',
          cookie: `${outsider.cookie}; ${access}`,
        })
      ).status,
    ).toBe(403);
  });

  it('reports the host audit and the owner’s factors', async () => {
    const owner = await signUpTestUser();
    writeFileSync(
      auditPath,
      JSON.stringify({
        version: 1,
        host: 'kingston-server',
        ranAt: new Date().toISOString(),
        checks: [
          {
            id: 'ssh.password_auth',
            group: 'ssh',
            state: 'pass',
            severity: 'critical',
            detail: 'no',
          },
          {
            id: 'net.firewall',
            group: 'network',
            state: 'fail',
            severity: 'critical',
            detail: 'accept',
          },
          {
            id: 'auth.sessions',
            group: 'auth',
            state: 'warn',
            severity: 'low',
            code: 'auth.sessions.warn',
            params: { count: 425, 'bad key': 'x', note: 'n'.repeat(300) },
            detail: '425 open owner sessions',
          },
          { id: 'bad id!', group: 'x', state: 'pass', severity: 'low', detail: '' },
          { id: 'sys.time_sync', group: 'system', state: 'maybe', severity: 'high', detail: '' },
        ],
      }),
    );
    const response = await call('/god/security/status', { cookie: owner.cookie });
    expect(response.status).toBe(200);
    const status = (await response.json()) as {
      audit: { summary: Record<string, number>; checks: unknown[] };
      health: { state: string };
      owner: { totp: boolean; passkey: boolean; activeSessions: number };
      edge: { configured: boolean };
    };
    expect(status.audit.checks).toHaveLength(3);
    expect(status.audit.summary).toMatchObject({ pass: 1, fail: 1, warn: 1 });
    // A report without codes gets them from id and state; params are bounded.
    expect(status.audit.checks).toContainEqual(
      expect.objectContaining({ id: 'net.firewall', code: 'net.firewall.fail', params: {} }),
    );
    expect(status.audit.checks).toContainEqual(
      expect.objectContaining({
        code: 'auth.sessions.warn',
        params: { count: 425, note: 'n'.repeat(200) },
      }),
    );
    expect(status.health.state).toBe('critical');
    expect(status.owner).toMatchObject({ totp: false, passkey: false });
    expect(status.owner.activeSessions).toBeGreaterThan(0);
    expect(status.edge.configured).toBe(false);

    const other = await signUpTestUser({ email: 'member2@example.com' });
    expect((await call('/god/security/status', { cookie: other.cookie })).status).toBe(403);
  });
});

describe('/auth/verify (the local tools behind nginx)', () => {
  beforeEach(resetDb);

  it('opens the tools for the owner’s signed-in browser only', async () => {
    const owner = await signUpTestUser();
    const member = await signUpTestUser({ email: 'tools-member@example.com' });
    expect((await call('/auth/verify', { cookie: owner.cookie })).status).toBe(204);
    expect((await call('/auth/verify', { cookie: member.cookie })).status).toBe(403);
    expect((await call('/auth/verify')).status).toBe(401);
    const key = await auth.api.createApiKey({ body: { userId: owner.userId, name: 'cli' } });
    expect((await call('/auth/verify', { 'x-api-key': key.key })).status).toBe(403);
    expect(
      (await call('/auth/verify', { cookie: owner.cookie, authorization: `Bearer ${key.key}` }))
        .status,
    ).toBe(403);
  });
});
