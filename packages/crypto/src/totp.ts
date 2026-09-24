import { Secret, TOTP, URI } from 'otpauth';

// Authenticator (TOTP, RFC 6238) keys of website logins: one parser and one code generator
// for all of Helena, on the `otpauth` library. A key is a base32 seed or an otpauth://totp
// link that may set digits, period and algorithm. The browser gateway asks Helena for the
// current code, so the seed itself never leaves Helena. The limits are the ones Hermes'
// vault accepts, so a key it would refuse is refused on save.

const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'];
const DIGITS = [6, 7, 8];

export class TotpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TotpError';
  }
}

export function parseTotpSecret(value: string): TOTP {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    let parsed: TOTP | unknown;
    try {
      parsed = URI.parse(trimmed);
    } catch {
      throw new TotpError('The otpauth link cannot be read.');
    }
    if (!(parsed instanceof TOTP)) throw new TotpError('Only otpauth://totp links are supported.');
    if (
      !DIGITS.includes(parsed.digits) ||
      !(parsed.period > 0) ||
      !ALGORITHMS.includes(parsed.algorithm.toUpperCase().replace('-', ''))
    ) {
      throw new TotpError('The otpauth link has settings Hermes does not support.');
    }
    return parsed;
  }
  const seed = trimmed.replace(/[\s-]/g, '').toUpperCase().replace(/=+$/, '');
  if (!seed || !/^[A-Z2-7]+$/.test(seed)) {
    throw new TotpError('The authenticator key must be a base32 key or an otpauth:// link.');
  }
  return new TOTP({ secret: Secret.fromBase32(seed), digits: 6, period: 30, algorithm: 'SHA1' });
}

export function assertTotpSecret(value: string): void {
  parseTotpSecret(value);
}

// The code valid at `atMs`.
export function totpCode(secret: string, atMs: number = Date.now()): string {
  return parseTotpSecret(secret).generate({ timestamp: atMs });
}

// Seconds until the code valid at `atMs` changes.
export function totpSecondsRemaining(secret: string, atMs: number = Date.now()): number {
  const period = parseTotpSecret(secret).period;
  return period - (Math.floor(atMs / 1000) % period);
}
