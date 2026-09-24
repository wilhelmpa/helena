import { decryptSecret, encryptSecret, secretContext, type EncryptedSecret } from '@repo/crypto';
import { sql } from 'drizzle-orm';
import { db } from './client';

// The secrets of a credential store row (integration_credential) are bound to that row:
// every writer and reader of its ciphertext goes through these two, so a ciphertext copied
// into another row does not decrypt there.

export function credentialContext(id: number): string {
  return secretContext('integration_credential', id, 'secrets');
}

export function sealCredential(id: number, plaintext: string): EncryptedSecret {
  return encryptSecret(plaintext, credentialContext(id));
}

export function openCredential(row: EncryptedSecret & { id: number }): string {
  return decryptSecret(row, credentialContext(row.id));
}

type Executor = Pick<typeof db, 'execute'>;

// The id the next credential row gets, taken before the insert so its secrets can be
// sealed to it.
export async function nextCredentialId(executor: Executor = db): Promise<number> {
  const rows = await executor.execute<{ id: string }>(
    sql`select nextval(pg_get_serial_sequence('integration_credential', 'id'))::text as id`,
  );
  return Number((rows as unknown as { id: string }[])[0]!.id);
}
