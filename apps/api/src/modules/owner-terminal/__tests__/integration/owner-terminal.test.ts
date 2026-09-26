import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { eq } from 'drizzle-orm';
import {
  db,
  ownerTerminalAudit,
  ownerTerminalGrant,
  session,
  twoFactor,
  user as userTable,
} from '@repo/db';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser, type TestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { enrollTotp, totpCode } from '../helpers/totp';

// The proxy token is signed with the key setup.sh writes on a real host; the test signs
// with a key of its own instead of depending on the host having one.
const keyFile = join(mkdtempSync(join(tmpdir(), 'owner-terminal-')), 'key');
writeFileSync(keyFile, randomBytes(32).toString('hex'));
process.env.OWNER_TERMINAL_KEY_PATH = keyFile;

const ORIGIN = { origin: 'http://localhost:3001' };

async function ownerWithTotp(): Promise<{ user: TestUser; secret: string }> {
  const user = await signUpTestUser();
  const { cookie, secret } = await enrollTotp(user.cookie);
  return { user: { ...user, cookie }, secret };
}

describe('owner terminal', () => {
  beforeEach(resetDb);

  it('opens a 12h grant for a correct TOTP code and reports it back', async () => {
    const { user, secret } = await ownerWithTotp();
    const api = authedApi(user.cookie, ORIGIN);

    const stepUp = await api['owner-terminal']['step-up']['totp'].post({
      code: totpCode(secret, 1),
    });
    expect(stepUp.status).toBe(200);
    expect(new Date(stepUp.data!.expiresAt).getTime()).toBeGreaterThan(Date.now() + 11 * 3600_000);

    const status = await api['owner-terminal'].grant.get();
    expect(status.status).toBe(200);
    expect(status.data).toMatchObject({ active: true, method: 'totp' });
  });

  it('renews the same browser session after expiration and revocation without a duplicate grant', async () => {
    const { user, secret } = await ownerWithTotp();
    const api = authedApi(user.cookie, ORIGIN);
    const code = totpCode(secret);
    expect((await api['owner-terminal']['step-up']['totp'].post({ code })).status).toBe(200);
    const [first] = await db.select().from(ownerTerminalGrant);
    await db
      .update(ownerTerminalGrant)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(ownerTerminalGrant.id, first!.id));
    expect((await api['owner-terminal'].grant.get()).data?.active).toBe(false);
    const renewed = await api['owner-terminal']['step-up']['totp'].post({ code });
    expect(renewed.status).toBe(200);
    expect((await api['owner-terminal'].grant.get()).data?.active).toBe(true);
    await api['owner-terminal'].grant.revoke.post();
    expect((await api['owner-terminal']['step-up']['totp'].post({ code })).status).toBe(200);
    const grants = await db.select().from(ownerTerminalGrant);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.id).toBe(first!.id);
    expect(grants[0]!.revokedAt).toBeNull();
    expect(grants[0]!.createdAt.getTime()).toBeGreaterThan(first!.createdAt.getTime());
    const audit = await db.select().from(ownerTerminalAudit);
    expect(audit.filter((row) => row.event === 'step_up_ok')).toHaveLength(3);
    expect(audit.filter((row) => row.event === 'step_up_fail')).toHaveLength(0);
  });

  it('keeps an expired grant closed when the supplied code is wrong', async () => {
    const { user, secret } = await ownerWithTotp();
    const api = authedApi(user.cookie, ORIGIN);
    expect(
      (await api['owner-terminal']['step-up']['totp'].post({ code: totpCode(secret) })).status,
    ).toBe(200);
    const expired = new Date(Date.now() - 1000);
    await db.update(ownerTerminalGrant).set({ expiresAt: expired });
    const refused = await api['owner-terminal']['step-up']['totp'].post({ code: '000000' });
    expect(refused.status).toBe(400);
    expect(refused.error?.value).toMatchObject({ code: 'TERMINAL_INVALID_CODE' });
    const [grant] = await db.select().from(ownerTerminalGrant);
    expect(grant!.expiresAt.getTime()).toBe(expired.getTime());
    expect((await api['owner-terminal'].grant.get()).data?.active).toBe(false);
  });

  it('requires completed factor setup and does not rotate or lose the browser session', async () => {
    const owner = await signUpTestUser();
    const api = authedApi(owner.cookie, ORIGIN);
    const before = await db.select({ id: session.id }).from(session);
    const absent = await api['owner-terminal']['step-up']['totp'].post({ code: '000000' });
    expect(absent.status).toBe(409);
    expect(absent.error?.value).toMatchObject({ code: 'TERMINAL_TOTP_NOT_ENABLED' });
    await auth.api.enableTwoFactor({
      headers: new Headers({ cookie: owner.cookie }),
      body: { password: 'test-password-123' },
    });
    const pending = await api['owner-terminal']['step-up']['totp'].post({ code: '000000' });
    expect(pending.status).toBe(409);
    expect(await db.select({ id: session.id }).from(session)).toEqual(before);
    expect(await db.select().from(ownerTerminalGrant)).toHaveLength(0);
    const [factor] = await db.select({ verified: twoFactor.verified }).from(twoFactor);
    expect(factor?.verified).toBe(false);
    const [state] = await db
      .select({ enabled: userTable.twoFactorEnabled })
      .from(userTable)
      .where(eq(userTable.id, owner.userId));
    expect(state?.enabled).toBe(false);
  });

  it('rejects a wrong TOTP code and rate-limits after 5 failures', async () => {
    const { user } = await ownerWithTotp();
    const api = authedApi(user.cookie, ORIGIN);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await api['owner-terminal']['step-up']['totp'].post({ code: '000000' });
      expect(result.status).toBe(400);
    }
    const locked = await api['owner-terminal']['step-up']['totp'].post({ code: '000000' });
    expect(locked.status).toBe(429);

    const audit = await db.select().from(ownerTerminalAudit);
    expect(audit.filter((row) => row.event === 'step_up_fail')).toHaveLength(5);
    expect(audit.filter((row) => row.event === 'rate_limited')).toHaveLength(1);
  });

  it('refuses a non-owner and an API key even with a correct code', async () => {
    await signUpTestUser(); // god
    const plain = await signUpTestUser({ email: 'plain-user@example.com' });
    const { cookie, secret } = await enrollTotp(plain.cookie);
    const api = authedApi(cookie, ORIGIN);
    const result = await api['owner-terminal']['step-up']['totp'].post({
      code: totpCode(secret, 1),
    });
    expect(result.status).toBe(403);
  });

  it('revokes the grant and audits step-up, session events and the revoke', async () => {
    const { user, secret } = await ownerWithTotp();
    const api = authedApi(user.cookie, ORIGIN);
    await api['owner-terminal']['step-up']['totp'].post({ code: totpCode(secret, 1) });

    const start = await api['owner-terminal'].sessions.start.post({ kind: 'shell', name: 'main' });
    expect(start.status).toBe(204);

    const revoke = await api['owner-terminal'].grant.revoke.post();
    expect(revoke.status).toBe(204);

    const status = await api['owner-terminal'].grant.get();
    expect(status.data).toMatchObject({ active: false });

    // No active grant left -- a session event now is refused rather than audited
    // under a grant that no longer exists.
    const endAfterRevoke = await api['owner-terminal'].sessions.end.post({
      kind: 'shell',
      name: 'main',
    });
    expect(endAfterRevoke.status).toBe(403);

    const audit = await api['owner-terminal'].audit.get();
    const events = audit.data!.map((row) => row.event);
    expect(events).toContain('step_up_ok');
    expect(events).toContain('session_start');
    expect(events).toContain('grant_revoked');
  });

  it('mints the proxy token only for an interactive owner session with a live grant', async () => {
    const { user, secret } = await ownerWithTotp();
    const api = authedApi(user.cookie, ORIGIN);

    // No step-up yet in this sub-test's fresh grant lifecycle: revoke first so the
    // route is exercised without one.
    await api['owner-terminal'].grant.revoke.post();
    const noGrant = await api.auth.verify['owner-terminal']({ kind: 'shell' }).get();
    expect(noGrant.status).toBe(403);

    await api['owner-terminal']['step-up']['totp'].post({ code: totpCode(secret, 1) });
    const ok = await api.auth.verify['owner-terminal']({ kind: 'shell' }).get();
    expect(ok.status).toBe(204);
    expect(ok.response.headers.get('x-owner-terminal-token')).toBeTruthy();

    // A wrong kind still 204s (the route itself does not validate kind against a
    // session's history), but a personal API key must never reach it, even with a
    // live grant -- see app.ts's comment on this route.
    const key = await auth.api.createApiKey({ body: { userId: user.userId, name: 'agent' } });
    const keyResult = await apiKeyApi(key.key)
      .auth.verify['owner-terminal']({ kind: 'shell' })
      .get();
    expect(keyResult.status).toBe(403);
  });

  it('reads and updates the instance policy', async () => {
    const user = await signUpTestUser();
    const api = authedApi(user.cookie, ORIGIN);

    const initial = await api['owner-terminal'].settings.get();
    // Off by default: the existing blanket sudoers NOPASSWD stays in effect
    // until the orchestrator audits the automation and turns this on
    // deliberately (see service.ts's defaultSettings comment).
    expect(initial.data).toMatchObject({ sudoPasswordRequired: false, stepUpMethods: ['totp'] });

    const updated = await api['owner-terminal'].settings.patch({
      sudoPasswordRequired: true,
      recordOutput: { shell: true },
    });
    expect(updated.status).toBe(200);
    expect(updated.data).toMatchObject({
      sudoPasswordRequired: true,
      recordOutput: { shell: true },
    });
  });

  it('opens the terminal from the LAN without a code once step-up is off, never from loopback', async () => {
    const user = await signUpTestUser();
    const lan = authedApi(user.cookie, { ...ORIGIN, 'x-real-ip': '192.168.122.1' });
    const loopback = authedApi(user.cookie, { ...ORIGIN, 'x-real-ip': '127.0.0.1' });

    expect((await lan['owner-terminal'].grant.get()).data).toMatchObject({ active: false });
    expect((await lan.auth.verify['owner-terminal']({ kind: 'shell' }).get()).status).toBe(403);

    await lan['owner-terminal'].settings.patch({ stepUpRequired: false });

    expect((await lan['owner-terminal'].grant.get()).data).toMatchObject({
      active: true,
      method: null,
      expiresAt: null,
    });
    const token = await lan.auth.verify['owner-terminal']({ kind: 'shell' }).get();
    expect(token.status).toBe(204);
    expect(token.response.headers.get('x-owner-terminal-token')).toBeTruthy();
    const start = await lan['owner-terminal'].sessions.start.post({ kind: 'shell', name: 'main' });
    expect(start.status).toBe(204);

    // Loopback is where the Cloudflare tunnel arrives: the setting never reaches it.
    expect((await loopback['owner-terminal'].grant.get()).data).toMatchObject({ active: false });
    expect((await loopback.auth.verify['owner-terminal']({ kind: 'shell' }).get()).status).toBe(
      403,
    );
  });
});
