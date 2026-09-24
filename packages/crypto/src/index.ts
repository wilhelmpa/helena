import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

// Symmetric encryption for secrets stored at rest. AES-256-GCM with a random 96-bit IV
// per value; the auth tag is stored alongside, so decryption is authenticated.
//
// Format v1 (written now): the ciphertext is prefixed "v1:". The key is derived from
// APP_ENCRYPTION_KEY with HKDF-SHA256 (RFC 5869) under a fixed salt and a versioned info
// string, so a new version can derive a new key from the same secret. Each value is
// bound to where it is stored with GCM's associated data, "<table>:<id>:<column>": a
// ciphertext copied into another row or column does not decrypt there.
//
// The legacy format (no prefix, key = SHA-256 of the env value, no associated data) is
// still read, and `reencrypt.ts` in @repo/db rewrites stored values to v1.
//
// A missing key is a clear startup-time error rather than a silent weak default.
// Changing the value makes existing stored credentials undecryptable.

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length.
const V1 = 'v1:';
const HKDF_SALT = 'helena/secrets';
const HKDF_INFO_V1 = 'helena/aes-256-gcm/v1';

let rawKey: Buffer | null = null;
let legacyKey: Buffer | null = null;
let keyV1: Buffer | null = null;

function secretMaterial(): Buffer {
  if (rawKey) return rawKey;
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('APP_ENCRYPTION_KEY is not set: generate one with `openssl rand -base64 32`.');
  }
  rawKey = Buffer.from(raw, 'utf8');
  return rawKey;
}

function currentKey(): Buffer {
  keyV1 ??= Buffer.from(hkdfSync('sha256', secretMaterial(), HKDF_SALT, HKDF_INFO_V1, 32));
  return keyV1;
}

function oldKey(): Buffer {
  legacyKey ??= createHash('sha256').update(secretMaterial()).digest();
  return legacyKey;
}

export interface EncryptedSecret {
  ciphertext: string; // "v1:" + base64, or base64 in the legacy format
  iv: string; // base64
  authTag: string; // base64
}

// Where a value is stored, as the associated data it is bound to.
export function secretContext(table: string, id: string | number, column: string): string {
  return `${table}:${id}:${column}`;
}

// Encrypts a UTF-8 plaintext, bound to `context` (see secretContext).
export function encryptSecret(plaintext: string, context = ''): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, currentKey(), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: V1 + ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

// Decrypts a value produced by encryptSecret with the same context, or a legacy value.
// Throws if the key or the context is wrong or the data was tampered with.
export function decryptSecret(enc: EncryptedSecret, context = ''): string {
  const v1 = enc.ciphertext.startsWith(V1);
  const decipher = createDecipheriv(
    ALGORITHM,
    v1 ? currentKey() : oldKey(),
    Buffer.from(enc.iv, 'base64'),
  );
  if (v1) decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(enc.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(v1 ? enc.ciphertext.slice(V1.length) : enc.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// Whether a stored value is in the current format.
export function isCurrentSecret(enc: Pick<EncryptedSecret, 'ciphertext'>): boolean {
  return enc.ciphertext.startsWith(V1);
}

// For tests of the legacy format: a value as the code before v1 wrote it.
export function encryptLegacySecretForTests(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, oldKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export * from './totp';
