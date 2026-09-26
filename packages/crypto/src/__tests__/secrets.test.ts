import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('rejects shortened GCM tags in current and legacy ciphertexts', () => {
    for (const enc of [encryptSecret('fixture', 'ctx'), encryptLegacySecretForTests('fixture')]) {
      for (const length of [0, 4, 8, 12, 15, 17]) {
        const tag = Buffer.concat([Buffer.from(enc.authTag, 'base64'), Buffer.alloc(1)]).subarray(
          0,
          length,
        );
        expect(() => decryptSecret({ ...enc, authTag: tag.toString('base64') }, 'ctx')).toThrow();
      }
      expect(decryptSecret(enc, 'ctx')).toBe('fixture');
    }
  });

  it('enforces full GCM tags on Node as well as Bun', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'helena-crypto-test-'));
    try {
      const bundle = await Bun.build({
        entrypoints: [new URL('../index.ts', import.meta.url).pathname],
        outdir: directory,
        naming: 'crypto.mjs',
        target: 'node',
      });
      expect(bundle.success).toBe(true);
      const script = `
        import assert from 'node:assert/strict';
        import { decryptSecret, encryptSecret, encryptLegacySecretForTests } from ${JSON.stringify(join(directory, 'crypto.mjs'))};
        for (const encrypted of [encryptSecret('fixture'), encryptLegacySecretForTests('fixture')]) {
          assert.equal(decryptSecret(encrypted), 'fixture');
          for (const length of [4, 8, 12, 15]) {
            const authTag = Buffer.from(encrypted.authTag, 'base64').subarray(0, length).toString('base64');
            assert.throws(() => decryptSecret({ ...encrypted, authTag }));
          }
        }
      `;
      expect(() =>
        execFileSync('node', ['--input-type=module', '-e', script], {
          env: { ...process.env, APP_ENCRYPTION_KEY: 'test-only-node-gcm-key-0123456789' },
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses a fresh IV every time', () => {
    const one = encryptSecret('same', 'ctx');
    const two = encryptSecret('same', 'ctx');
    expect(one.iv).not.toBe(two.iv);
    expect(one.ciphertext).not.toBe(two.ciphertext);
  });
});
