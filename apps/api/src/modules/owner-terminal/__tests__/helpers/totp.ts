import { createHmac } from 'node:crypto';
import { auth } from '@repo/auth';

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

export function totpCode(secret: string, offsetSteps = 0): string {
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
export async function enrollTotp(cookie: string): Promise<{ cookie: string; secret: string }> {
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
