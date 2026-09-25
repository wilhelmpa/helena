import { eq, sql } from 'drizzle-orm';
import { decryptSecret, encryptSecret, secretContext } from '@repo/crypto';
import { db } from './client';
import { appSecret } from './schema/app';

// Encrypted instance configuration (app_secret): one JSON blob per key, encrypted as
// a whole, with a `redacted` mirror the settings UI reads without decrypting. The
// plaintext counterpart is settings.ts (app_setting).
//
// It lives here because the api, @repo/auth and the bot all go through it, and only a
// process holding APP_ENCRYPTION_KEY can read a value back.

export async function readSecret<T>(key: string): Promise<T | null> {
  const rows = await db
    .select({ ciphertext: appSecret.ciphertext, iv: appSecret.iv, authTag: appSecret.authTag })
    .from(appSecret)
    .where(eq(appSecret.key, key));
  const row = rows[0];
  return row
    ? (JSON.parse(decryptSecret(row, secretContext('app_secret', key, 'value'))) as T)
    : null;
}

export async function writeSecret(key: string, value: unknown, redacted: object): Promise<void> {
  const enc = encryptSecret(JSON.stringify(value), secretContext('app_secret', key, 'value'));
  await db
    .insert(appSecret)
    .values({
      key,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      redacted,
    })
    .onConflictDoUpdate({
      target: appSecret.key,
      set: {
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        redacted,
        updatedAt: sql`now()`,
      },
    });
}

// Stores a secret only when the key has none yet; returns whether this call stored it. For
// a value generated once (a key pair two processes might create at the same moment): the
// loser of the race reads the winner's value back.
export async function insertSecretIfAbsent(
  key: string,
  value: unknown,
  redacted: object,
): Promise<boolean> {
  const enc = encryptSecret(JSON.stringify(value), secretContext('app_secret', key, 'value'));
  const rows = await db
    .insert(appSecret)
    .values({ key, ciphertext: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, redacted })
    .onConflictDoNothing({ target: appSecret.key })
    .returning({ key: appSecret.key });
  return rows.length > 0;
}

// The redacted mirror of a secret, read without decrypting (null when there is none).
export async function readRedactedSecret<T extends object>(key: string): Promise<T | null> {
  const rows = await db
    .select({ redacted: appSecret.redacted })
    .from(appSecret)
    .where(eq(appSecret.key, key));
  return (rows[0]?.redacted as T | undefined) ?? null;
}
