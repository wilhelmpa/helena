import { describe, expect, it } from 'bun:test';
import { assertTotpSecret, totpCode, totpSecondsRemaining } from '../totp';

// RFC 6238 appendix B: the ASCII seed "12345678901234567890" (base32 below) gives these
// 8-digit SHA1 codes.
const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP', () => {
  it('computes the RFC 6238 test vectors from an otpauth link', () => {
    const link = `otpauth://totp/Test?secret=${RFC_SEED}&digits=8&period=30&algorithm=SHA1`;
    expect(totpCode(link, 59_000)).toBe('94287082');
    expect(totpCode(link, 1_111_111_109_000)).toBe('07081804');
    expect(totpCode(link, 2_000_000_000_000)).toBe('69279037');
  });

  it('reads a bare base32 key with spaces as six digits every 30 seconds', () => {
    const code = totpCode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59_000);
    expect(code).toBe('287082');
    expect(totpSecondsRemaining(RFC_SEED, 59_000)).toBe(1);
    expect(totpSecondsRemaining(RFC_SEED, 60_000)).toBe(30);
  });

  it('refuses what Hermes would refuse', () => {
    for (const bad of [
      'not base32!',
      'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=10',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
    ]) {
      expect(() => assertTotpSecret(bad)).toThrow();
    }
    expect(() => assertTotpSecret('JBSWY3DPEHPK3PXP')).not.toThrow();
  });
});
