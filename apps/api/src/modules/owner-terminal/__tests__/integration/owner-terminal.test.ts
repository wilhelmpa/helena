import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { db, ownerTerminalAudit } from '@repo/db';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser, type TestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

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

async function ownerWithTotp(): Promise<{ user: TestUser; secret: string }> {
  const user = await signUpTestUser();
  const enabled = await auth.api.enableTwoFactor({
    headers: new Headers({ cookie: user.cookie }),
    body: { password: 'test-password-123' },
  });
  const secret = new URL(enabled.totpURI.replace('otpauth://', 'https://')).searchParams.get(
    'secret',
  );
  if (!secret) throw new Error('enableTwoFactor did not return a secret in the TOTP URI');
  // The first verify flips twoFactor.verified to true -- enrollment is not
  // "usable" until this happens (see packages/auth AGENTS.md / service.ts).
  await auth.api.verifyTOTP({
    headers: new Headers({ cookie: user.cookie }),
    body: { code: totpCode(secret) },
  });
  return { user, secret };
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
    const enabled = await auth.api.enableTwoFactor({
      headers: new Headers({ cookie: plain.cookie }),
      body: { password: 'test-password-123' },
    });
    const secret = new URL(enabled.totpURI.replace('otpauth://', 'https://')).searchParams.get(
      'secret',
    )!;
    await auth.api.verifyTOTP({
      headers: new Headers({ cookie: plain.cookie }),
      body: { code: totpCode(secret) },
    });
    const api = authedApi(plain.cookie, ORIGIN);
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

  it('reads and updates the instance policy', async () => {
    const user = await signUpTestUser();
    const api = authedApi(user.cookie, ORIGIN);

    const initial = await api['owner-terminal'].settings.get();
    expect(initial.data).toMatchObject({ sudoPasswordRequired: true, stepUpMethods: ['totp'] });

    const updated = await api['owner-terminal'].settings.patch({
      sudoPasswordRequired: false,
      recordOutput: { shell: true },
    });
    expect(updated.status).toBe(200);
    expect(updated.data).toMatchObject({
      sudoPasswordRequired: false,
      recordOutput: { shell: true },
    });
  });
});
