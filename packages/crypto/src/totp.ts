import { createHmac } from 'node:crypto';

// RFC 6238 TOTP codes, computed from the same authenticator key shape the Credentials page
// accepts (kinds.ts assertTotpSecret): a base32 seed, or an otpauth://totp link that can
// override digits/period/algorithm. Plan computes the code here so the seed itself never has
// to leave Plan (design: docs/volition-design-browser-gateway.md §6, "Plan berechnet den
// Code... Das TOTP-Secret verlässt Plan nie."). No third-party TOTP package: this is a small,
// well-specified algorithm over node:crypto's own HMAC.

const TOTP_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'] as const;
type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];

interface ParsedTotpSecret {
  seed: string; // base32, still encoded
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
}

// Mirrors apps/api's assertTotpSecret parsing exactly (kept independent on purpose: this
// package has no dependency on the API module, and the shapes are small enough that
// duplicating the parse is clearer than adding a cross-package import for it).
export function parseTotpSecret(value: string): ParsedTotpSecret {
  const trimmed = value.trim();
  let seed = trimmed;
  let digits = 6;
  let period = 30;
  let algorithm: TotpAlgorithm = 'SHA1';
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    const url = new URL(trimmed);
    if (url.host.toLowerCase() !== 'totp') {
      throw new Error('Only otpauth://totp links are supported.');
    }
    seed = url.searchParams.get('secret') ?? '';
    digits = Number(url.searchParams.get('digits') ?? 6);
    period = Number(url.searchParams.get('period') ?? 30);
    const rawAlgorithm = (url.searchParams.get('algorithm') ?? 'SHA1')
      .toUpperCase()
      .replace('-', '');
    if (
      ![6, 7, 8].includes(digits) ||
      !(period > 0) ||
      !TOTP_ALGORITHMS.includes(rawAlgorithm as TotpAlgorithm)
    ) {
      throw new Error('The otpauth link has settings that are not supported.');
    }
    algorithm = rawAlgorithm as TotpAlgorithm;
  }
  const normalized = seed.replace(/[\s-]/g, '').toUpperCase().replace(/=+$/, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('The authenticator key must be a base32 key or an otpauth:// link.');
  }
  return { seed: normalized, digits, period, algorithm };
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(base32: string): Buffer {
  let bits = '';
  for (const char of base32) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in authenticator key.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(key: Buffer, counter: bigint, digits: number, algorithm: TotpAlgorithm): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const hmac = createHmac(algorithm.toLowerCase(), key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

// The current TOTP code for a saved authenticator key. Never returns or logs the key.
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const parsed = parseTotpSecret(secret);
  const key = base32Decode(parsed.seed);
  const counter = BigInt(Math.floor(atMs / 1000 / parsed.period));
  return hotp(key, counter, parsed.digits, parsed.algorithm);
}

// Seconds until the current code changes, for a UI that wants to show a countdown without
// ever holding the code itself for longer than it is valid.
export function totpSecondsRemaining(secret: string, atMs: number = Date.now()): number {
  const parsed = parseTotpSecret(secret);
  const elapsed = Math.floor(atMs / 1000) % parsed.period;
  return parsed.period - elapsed;
}
