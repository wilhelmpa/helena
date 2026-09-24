import { describe, expect, it } from 'bun:test';
import { parseTotpSecret, TotpSecretError, totpCode, totpSecondsRemaining } from './totp';

// RFC 6238 Appendix B test vectors use the ASCII seed "12345678901234567890" (SHA1, 20
// bytes), base32-encoded below, with 8-digit codes and a few known timestamps.
const RFC6238_SHA1_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totpCode', () => {
  it('matches the RFC 6238 SHA1 test vector at T=59s (counter 1)', () => {
    expect(totpCode(`otpauth://totp/x?secret=${RFC6238_SHA1_SECRET_BASE32}&digits=8`, 59_000)).toBe(
      '94287082',
    );
  });

  it('matches the RFC 6238 SHA1 test vector at T=1111111109s (counter 37037036)', () => {
    expect(
      totpCode(`otpauth://totp/x?secret=${RFC6238_SHA1_SECRET_BASE32}&digits=8`, 1_111_111_109_000),
    ).toBe('07081804');
  });

  it('defaults to 6 digits and a 30s period for a plain base32 secret', () => {
    const code = totpCode(RFC6238_SHA1_SECRET_BASE32, 59_000);
    expect(code).toHaveLength(6);
    // The 8-digit vector above is "94287082"; the 6-digit code is its low-order digits per
    // RFC 6238's own truncation (same HOTP value, fewer digits kept).
    expect(code).toBe('287082');
  });

  it('is stable within one period and changes across a period boundary', () => {
    const secret = RFC6238_SHA1_SECRET_BASE32;
    expect(totpCode(secret, 0)).toBe(totpCode(secret, 29_000));
    expect(totpCode(secret, 0)).not.toBe(totpCode(secret, 30_000));
  });

  it('accepts a bare base32 secret with spaces and lowercase, like a pasted key', () => {
    const spaced = 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq';
    expect(totpCode(spaced, 59_000)).toBe(totpCode(RFC6238_SHA1_SECRET_BASE32, 59_000));
  });

  it('rejects a secret with characters outside the base32 alphabet', () => {
    expect(() => totpCode('not-base32-!!!')).toThrow();
  });
});

describe('parseTotpSecret', () => {
  it('reads digits/period/algorithm overrides from an otpauth link', () => {
    const parsed = parseTotpSecret(
      `otpauth://totp/x?secret=${RFC6238_SHA1_SECRET_BASE32}&digits=8&period=60&algorithm=SHA256`,
    );
    expect(parsed.secret.base32).toBe(RFC6238_SHA1_SECRET_BASE32);
    expect([parsed.digits, parsed.period, parsed.algorithm]).toEqual([8, 60, 'SHA256']);
  });

  it("refuses what Hermes' vault refuses, with a message for the person", () => {
    for (const value of [
      'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=9',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
      'otpauth://totp/x',
      'JBSWY3DPEHPK3PX1',
      '',
    ]) {
      expect(() => parseTotpSecret(value)).toThrow(TotpSecretError);
    }
  });
});

describe('totpSecondsRemaining', () => {
  it('counts down within a 30s period and wraps at the boundary', () => {
    expect(totpSecondsRemaining(RFC6238_SHA1_SECRET_BASE32, 0)).toBe(30);
    expect(totpSecondsRemaining(RFC6238_SHA1_SECRET_BASE32, 29_000)).toBe(1);
    expect(totpSecondsRemaining(RFC6238_SHA1_SECRET_BASE32, 30_000)).toBe(30);
  });
});
