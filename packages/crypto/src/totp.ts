import { Secret, TOTP, URI } from 'otpauth';

// TOTP codes (RFC 6238) for the authenticator keys the Credentials page accepts: a base32
// key, or an otpauth://totp link that can set digits, period and algorithm. Helena computes
// the code itself so the key never leaves it (docs/volition-design-browser-gateway.md §6).
// One implementation and one otpauth:// parser for all of Helena (orchestrator decision
// D-C5): the `otpauth` library (MIT); this file only adds the rules Hermes' vault applies,
// so a key it would refuse is refused on save.

const DIGITS = [6, 7, 8];
const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'];

// An authenticator key Helena does not accept; the message is for the person who typed it.
export class TotpSecretError extends Error {}

export function parseTotpSecret(value: string): TOTP {
  const trimmed = value.trim();
  if (/^otpauth:\/\//i.test(trimmed)) {
    let parsed: ReturnType<typeof URI.parse>;
    try {
      parsed = URI.parse(trimmed);
    } catch {
      throw new TotpSecretError(
        'The authenticator key must be a base32 key or an otpauth:// link.',
      );
    }
    if (!(parsed instanceof TOTP)) {
      throw new TotpSecretError('Only otpauth://totp links are supported.');
    }
    if (
      !DIGITS.includes(parsed.digits) ||
      !(parsed.period > 0) ||
      !ALGORITHMS.includes(parsed.algorithm)
    ) {
      throw new TotpSecretError('The otpauth link has settings Hermes does not support.');
    }
    return parsed;
  }
  const normalized = trimmed.replace(/[\s-]/g, '').toUpperCase().replace(/=+$/, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new TotpSecretError('The authenticator key must be a base32 key or an otpauth:// link.');
  }
  return new TOTP({ secret: Secret.fromBase32(normalized) });
}

// The current code for a saved authenticator key. Never returns or logs the key.
export function totpCode(secret: string, atMs: number = Date.now()): string {
  return parseTotpSecret(secret).generate({ timestamp: atMs });
}

// Seconds until the current code changes.
export function totpSecondsRemaining(secret: string, atMs: number = Date.now()): number {
  const { period } = parseTotpSecret(secret);
  return period - (Math.floor(atMs / 1000) % period);
}
