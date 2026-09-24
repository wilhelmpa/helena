import { describe, expect, it } from 'bun:test';
import {
  decryptSecret,
  encryptLegacySecretForTests,
  encryptSecret,
  isCurrentSecret,
  secretContext,
} from '../index';

process.env.APP_ENCRYPTION_KEY ??= 'test-only-app-encryption-key-0123456789';

describe('stored secrets', () => {
  it('writes the versioned format and reads it back only in its own place', () => {
    const here = secretContext('integration_credential', 7, 'secrets');
    const enc = encryptSecret('{"password":"s3cret"}', here);
    expect(isCurrentSecret(enc)).toBe(true);
    expect(enc.ciphertext.startsWith('v1:')).toBe(true);
    expect(enc.ciphertext).not.toContain('s3cret');
    expect(decryptSecret(enc, here)).toBe('{"password":"s3cret"}');
    // Copied into another row or column, the ciphertext does not decrypt.
    expect(() =>
      decryptSecret(enc, secretContext('integration_credential', 8, 'secrets')),
    ).toThrow();
    expect(() => decryptSecret(enc)).toThrow();
  });

  it('still reads the legacy format', () => {
    const legacy = encryptLegacySecretForTests('old value');
    expect(isCurrentSecret(legacy)).toBe(false);
    expect(decryptSecret(legacy)).toBe('old value');
    expect(decryptSecret(legacy, 'ignored for legacy values')).toBe('old value');
  });

  it('refuses a tampered value', () => {
    const enc = encryptSecret('value', 'ctx');
    const bytes = Buffer.from(enc.ciphertext.slice(3), 'base64');
    bytes[0] = bytes[0]! ^ 1;
    expect(() =>
      decryptSecret({ ...enc, ciphertext: `v1:${bytes.toString('base64')}` }, 'ctx'),
    ).toThrow();
  });

  it('uses a fresh IV every time', () => {
    const one = encryptSecret('same', 'ctx');
    const two = encryptSecret('same', 'ctx');
    expect(one.iv).not.toBe(two.iv);
    expect(one.ciphertext).not.toBe(two.ciphertext);
  });
});
