import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { db, ownerTerminalAudit } from '@repo/db';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser, type TestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// The proxy token is signed with the key setup.sh writes on a real host; the test signs
// with a key of its own instead of depending on the host having one.
const keyFile = join(mkdtempSync(join(tmpdir(), 'owner-terminal-')), 'key');
writeFileSync(keyFile, randomBytes(32).toString('hex'));
process.env.OWNER_TERMINAL_KEY_PATH = keyFile;

const ORIGIN = { origin: 'http://localhost:3001' };

// A plain RFC 6238 TOTP generator, independent of better-auth's own (which this
// test deliberately does not import -- it exercises the api's HTTP surface, the
// same way an authenticator app would produce a code from the enrolled secret).
function base32Decode(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.replace(/=+$/, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, offsetSteps = 0): string {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

// Enrolls TOTP for an already signed-in cookie and confirms it with one code, as
// the enrollment screen at Account -> Security does. The confirming verifyTOTP
// call is also where better-auth marks `twoFactorEnabled` on the user, and it
// rotates the session while doing so (better-auth's two-factor plugin: the first
// successful verify replaces the session and deletes the old token) -- so this
// returns the cookie the caller must use afterward, not the one it started with.
async function enrollTotp(cookie: string): Promise<{ cookie: string; secret: string }> {
  const enabled = await auth.api.enableTwoFactor({
    headers: new Headers({ cookie }),
    body: { password: 'test-password-123' },
  });
  const secret = new URL(enabled.totpURI.replace('otpauth://', 'https://')).searchParams.get(
    'secret',
  );
  if (!secret) throw new Error('enableTwoFactor did not return a secret in the TOTP URI');
  const response = await auth.api.verifyTOTP({
    headers: new Headers({ cookie }),
    body: { code: totpCode(secret) },
    asResponse: true,
  });
  const setCookies = response.headers.getSetCookie();
  const nextCookie =
    setCookies.length > 0 ? setCookies.map((c) => c.split(';')[0]).join('; ') : cookie;
  return { cookie: nextCookie, secret };
}

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

  it('rejects a wrong TOTP code and rate-limits after 5 failures', async () => {
    const { user } = await ownerWithTotp();
    const api = authedApi(user.cookie, ORIGIN);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await api['owner-terminal']['step-up']['totp'].post({ code: '000000' });
      expect(result.status).toBe(401);
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
});
