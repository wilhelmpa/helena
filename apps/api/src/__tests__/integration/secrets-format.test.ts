import { beforeEach, describe, expect, it } from 'bun:test';
import { encryptLegacySecretForTests, isCurrentSecret } from '@repo/crypto';
import { db, integrationCredential, nextCredentialId, reencryptAll } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// Stored secrets move from the legacy format to v1 (HKDF key, bound to their row): a
// legacy value keeps working, the re-encryption rewrites it once, and a ciphertext copied
// into another row no longer decrypts there.

describe('secret format', () => {
  beforeEach(resetDb);

  it('reads a legacy credential, rewrites it bound to its row, and refuses a copy', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const asOwner = authedApi(owner.cookie);
    const project = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
    const teamId = project.teamId;
    const id = await nextCredentialId();
    await db.insert(integrationCredential).values({
      id,
      teamId,
      integrationKey: 'secret',
      label: 'LEGACY',
      ...encryptLegacySecretForTests(JSON.stringify({ value: 'legacy-value' })),
      redacted: { notes: '', value: true },
    });
    const credential = asOwner.teams({ teamId }).credentials({ credentialId: id });
    // Changing the notes reads the stored value and writes it back in the new format.
    expect((await credential.patch({ notes: 'still readable' })).status).toBe(200);
    const [rewritten] = await db
      .select()
      .from(integrationCredential)
      .where(eq(integrationCredential.id, id));
    expect(isCurrentSecret(rewritten!)).toBe(true);

    // A second legacy row, rewritten by the migration script, idempotently.
    const other = await nextCredentialId();
    await db.insert(integrationCredential).values({
      id: other,
      teamId,
      integrationKey: 'secret',
      label: 'OTHER',
      ...encryptLegacySecretForTests(JSON.stringify({ value: 'other-value' })),
      redacted: { notes: '', value: true },
    });
    expect(await reencryptAll()).toEqual({ integration_credential: 1 });
    expect(await reencryptAll()).toEqual({});
    expect(
      (await asOwner.teams({ teamId }).credentials({ credentialId: other }).patch({ notes: 'x' }))
        .status,
    ).toBe(200);

    // The first row's ciphertext pasted into the second: it is sealed to the first row.
    await db
      .update(integrationCredential)
      .set({ ciphertext: rewritten!.ciphertext, iv: rewritten!.iv, authTag: rewritten!.authTag })
      .where(eq(integrationCredential.id, other));
    const copied = await asOwner
      .teams({ teamId })
      .credentials({ credentialId: other })
      .patch({ notes: 'y' });
    expect(copied.status).toBe(500);
  });
});
