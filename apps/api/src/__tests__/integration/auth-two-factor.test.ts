import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { account, db } from '@repo/db';
import { parseTotpSecret } from '@repo/crypto';
import { eq } from 'drizzle-orm';
import { app } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

let address = 0;
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
const call = (path: string, body: object, cookie = '') =>
  app.handle(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://localhost:3001',
        'content-type': 'application/json',
        'x-real-ip': `192.0.2.${++address}`,
      },
      body: JSON.stringify(body),
    }),
  );

async function enroll(cookie: string, password?: string) {
  const enabled = await call('/two-factor/enable', password ? { password } : {}, cookie);
  expect(enabled.status).toBe(200);
  const body = (await enabled.json()) as { totpURI: string };
  const secret = new URL(body.totpURI).searchParams.get('secret')!;
  const verified = await call(
    '/two-factor/verify-totp',
    { code: parseTotpSecret(secret).generate() },
    cookie,
  );
  expect(verified.status).toBe(200);
  return { cookie: cookies(verified), secret };
}

describe('two-factor authentication', () => {
  beforeEach(resetDb);

  it('lets an SSO-only account enroll and disable TOTP without a password', async () => {
    const user = await signUpTestUser();
    // SSO-only fixture: the session belongs to a user without a password account.
    await db.delete(account).where(eq(account.userId, user.userId));
    const enrolled = await enroll(user.cookie);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: enrolled.cookie }),
    });
    expect(session?.user.twoFactorEnabled).toBe(true);
    const disabled = await call('/two-factor/disable', {}, enrolled.cookie);
    expect(disabled.status).toBe(200);
  });

  it('still requires the existing password for enrollment and disabling', async () => {
    const user = await signUpTestUser();
    expect((await call('/two-factor/enable', {}, user.cookie)).status).toBe(400);
    const enrolled = await enroll(user.cookie, 'test-password-123');
    expect((await call('/two-factor/disable', {}, enrolled.cookie)).status).toBe(400);
  });

  for (const identifier of ['email', 'username'] as const) {
    it(`requires TOTP after ${identifier} password sign-in, including the SSO fallback form`, async () => {
      const user = await signUpTestUser();
      await enroll(user.cookie, 'test-password-123');
      const response = await call(`/sign-in/${identifier}`, {
        [identifier]: user[identifier],
        password: 'test-password-123',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: cookies(response) }),
      });
      expect(session).toBeNull();
    });
  }
});
