import { db, integrationCredential, openCredential } from '@repo/db';
import { googleAccessToken, GoogleAuthError } from '@helena/connectors/google';
import { eq } from 'drizzle-orm';

// The OAuth access token a mailbox signs in with (SASL XOAUTH2) when it is the Mail
// service of a Google account: Google's library trades the refresh token the access
// center holds for a short-lived access token, which never leaves the worker. A grant
// Google no longer accepts marks the account 'needs_auth', so the access center shows it.

async function credential(id: number) {
  const [row] = await db
    .select({
      id: integrationCredential.id,
      kind: integrationCredential.integrationKey,
      redacted: integrationCredential.redacted,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(eq(integrationCredential.id, id));
  if (!row) return null;
  return {
    kind: row.kind,
    readable: (row.redacted ?? {}) as Record<string, unknown>,
    secrets: JSON.parse(openCredential(row)) as Record<string, string>,
  };
}

export async function mailAccessToken(credentialId: number): Promise<string> {
  const account = await credential(credentialId);
  if (!account || account.kind !== 'google') throw new Error('The Google account is gone');
  if (account.readable.engine === 'gog') {
    throw new Error('An account kept in gog cannot sign in to its mailbox');
  }
  const refreshToken = account.secrets.refreshToken;
  const clientId = account.readable.clientCredentialId;
  if (!refreshToken || typeof clientId !== 'number')
    throw new Error('The account is not signed in');
  const client = await credential(clientId);
  if (!client || client.kind !== 'google_oauth_client') throw new Error('The OAuth client is gone');
  try {
    const { token } = await googleAccessToken(
      {
        type: client.readable.type === 'web' ? 'web' : 'installed',
        clientId: String(client.readable.clientId ?? ''),
        clientSecret: client.secrets.clientSecret ?? '',
        projectId: null,
        redirectUris: [],
      },
      refreshToken,
      `google:${credentialId}`,
    );
    return token;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await db
        .update(integrationCredential)
        .set({ status: error.status, statusDetail: error.message, checkedAt: new Date() })
        .where(eq(integrationCredential.id, credentialId));
    }
    throw error;
  }
}
