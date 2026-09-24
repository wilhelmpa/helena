// Rewrites every stored secret still in the legacy format (SHA-256 key, no associated
// data) to format v1 (HKDF key, bound to its row), see @repo/crypto. Idempotent: a value
// already in v1 is left alone, so it can run after every deploy. Run once after the
// migration that ships it:
//
//   bun --env-file=<env> packages/db/src/reencrypt.ts [--dry-run]
//
// It needs APP_ENCRYPTION_KEY and prints only counts, never a value.
import { decryptSecret, encryptSecret, isCurrentSecret, secretContext } from '@repo/crypto';
import type { EncryptedSecret } from '@repo/crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { credentialContext } from './credential-crypto';
import { notificationContext } from './domains/notification-settings';
import {
  appSecret,
  connectorAuthSession,
  gitProviderConnection,
  integrationCredential,
  projectSetting,
  teamNotificationSetting,
} from './schema';

const dryRun = process.argv.includes('--dry-run');

function rewrap(value: EncryptedSecret, context: string): EncryptedSecret | null {
  if (isCurrentSecret(value)) return null;
  return encryptSecret(decryptSecret(value), context);
}

export async function reencryptAll(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const count = (table: string) => (counts[table] = (counts[table] ?? 0) + 1);

  for (const row of await db.select().from(integrationCredential)) {
    const next = rewrap(row, credentialContext(row.id));
    if (!next) continue;
    count('integration_credential');
    if (!dryRun) {
      await db.update(integrationCredential).set(next).where(eq(integrationCredential.id, row.id));
    }
  }

  for (const row of await db.select().from(appSecret)) {
    const next = rewrap(row, secretContext('app_secret', row.key, 'value'));
    if (!next) continue;
    count('app_secret');
    if (!dryRun) await db.update(appSecret).set(next).where(eq(appSecret.key, row.key));
  }

  for (const row of await db.select().from(teamNotificationSetting)) {
    const next = rewrap(row, notificationContext(row.teamId));
    if (!next) continue;
    count('team_notification_setting');
    if (!dryRun) {
      await db
        .update(teamNotificationSetting)
        .set(next)
        .where(eq(teamNotificationSetting.teamId, row.teamId));
    }
  }

  for (const row of await db.select().from(gitProviderConnection)) {
    const next = rewrap(row, secretContext('git_provider_connection', row.id, 'token'));
    if (!next) continue;
    count('git_provider_connection');
    if (!dryRun) {
      await db.update(gitProviderConnection).set(next).where(eq(gitProviderConnection.id, row.id));
    }
  }

  const gitSettings = await db.select().from(projectSetting).where(eq(projectSetting.key, 'git'));
  for (const row of gitSettings) {
    const value = row.value as { secret?: EncryptedSecret };
    if (!value?.secret) continue;
    const next = rewrap(
      value.secret,
      secretContext('project_setting', row.projectId, 'git.secret'),
    );
    if (!next) continue;
    count('project_setting.git');
    if (!dryRun) {
      await db
        .update(projectSetting)
        .set({ value: { ...value, secret: next } })
        .where(and(eq(projectSetting.projectId, row.projectId), eq(projectSetting.key, 'git')));
    }
  }

  // A sign-in under way lives for minutes: a legacy one is dropped rather than rewritten.
  const sessions = await db
    .select({ id: connectorAuthSession.id, ciphertext: connectorAuthSession.ciphertext })
    .from(connectorAuthSession);
  for (const row of sessions) {
    if (isCurrentSecret(row)) continue;
    count('connector_auth_session');
    if (!dryRun) {
      await db.delete(connectorAuthSession).where(eq(connectorAuthSession.id, row.id));
    }
  }
  return counts;
}

if (import.meta.main) {
  const counts = await reencryptAll();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(
    `${dryRun ? '[dry run] would re-encrypt' : 're-encrypted'} ${total} secrets` +
      (total ? `: ${JSON.stringify(counts)}` : ''),
  );
  process.exit(0);
}
