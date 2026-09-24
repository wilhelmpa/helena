import { decryptSecret } from '@repo/crypto';
import {
  db,
  integrationCredential,
  mailAccount,
  mailAction,
  mailAttachment,
  mailFolder,
  mailMessage,
  mailMessageFolder,
  mailThread,
  mailThreadIssue,
  project,
} from '@repo/db';
import {
  assertNoSymlinks,
  vaultAbsolute,
  type FolderRole,
  type MailServerSettings,
} from '@repo/mail';
import { deleteObject, deleteObjectFolder } from '@repo/storage';
import { rmdir, unlink } from 'node:fs/promises';
import { and, asc, eq, inArray, lt, notExists, sql } from 'drizzle-orm';
import { mailAccessToken } from './oauth';

export interface SyncAccount {
  id: number;
  teamId: number;
  projectId: number | null;
  address: string;
  // 'xoauth2': signs in with the OAuth token of the Google account it is the Mail service
  // of, fetched fresh for every connection (connectSettings).
  auth: 'password' | 'xoauth2';
  credentialId: number;
  // Only mail of the last fetchDays days is imported; null imports everything.
  fetchDays: number | null;
  syncTrash: boolean;
  syncSpam: boolean;
  triageEnabled: boolean;
  // Changes when the owner edits the account or its password; the worker then reconnects.
  version: string;
  settings: MailServerSettings;
}

export type FolderRow = typeof mailFolder.$inferSelect;

type AccountRow = typeof mailAccount.$inferSelect;
type CredentialRow = Pick<
  typeof integrationCredential.$inferSelect,
  'ciphertext' | 'iv' | 'authTag' | 'updatedAt'
>;

// The server settings of an account. A password account reads its password from its
// credential (a 'secret' of the credential store, whose value is the password); an
// XOAUTH2 account gets its token when it connects.
export function accountSettings(row: AccountRow, credential: CredentialRow): MailServerSettings {
  const base = {
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapTls: row.imapTls,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpTls: row.smtpTls,
    username: row.username,
  };
  if (row.auth === 'xoauth2') return base;
  const secret = JSON.parse(decryptSecret(credential)) as { value?: string };
  if (!secret.value) throw new Error('The credential holds no value');
  return {
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapTls: row.imapTls,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpTls: row.smtpTls,
    username: row.username,
    password: secret.value,
  };
}

const credentialColumns = {
  ciphertext: integrationCredential.ciphertext,
  iv: integrationCredential.iv,
  authTag: integrationCredential.authTag,
  updatedAt: integrationCredential.updatedAt,
};

export async function accountWithCredential(accountId: number) {
  const [row] = await db
    .select({ account: mailAccount, credential: credentialColumns })
    .from(mailAccount)
    .innerJoin(integrationCredential, eq(integrationCredential.id, mailAccount.credentialId))
    .where(eq(mailAccount.id, accountId));
  return row ?? null;
}

// The accounts the worker keeps a connection to: enabled and with a password.
export async function loadSyncAccounts(): Promise<SyncAccount[]> {
  const rows = await db
    .select({ account: mailAccount, credential: credentialColumns })
    .from(mailAccount)
    .innerJoin(integrationCredential, eq(integrationCredential.id, mailAccount.credentialId))
    .where(eq(mailAccount.enabled, true));
  return rows.flatMap(({ account, credential }) => {
    try {
      return [
        {
          id: account.id,
          teamId: account.teamId,
          projectId: account.projectId,
          address: account.address,
          syncTrash: account.syncTrash,
          syncSpam: account.syncSpam,
          triageEnabled: account.triageEnabled,
          auth: account.auth === 'xoauth2' ? 'xoauth2' : 'password',
          credentialId: account.credentialId!,
          fetchDays: account.fetchDays,
          version: `${account.updatedAt.toISOString()} ${credential.updatedAt.toISOString()}`,
          settings: accountSettings(account, credential),
        },
      ];
    } catch {
      console.error(`[mail] the password of account ${account.id} cannot be read`);
      return [];
    }
  });
}

// The settings to connect with: an XOAUTH2 account's current access token added.
export async function connectSettings(
  account: Pick<SyncAccount, 'auth' | 'credentialId' | 'settings'>,
): Promise<MailServerSettings> {
  if (account.auth !== 'xoauth2') return account.settings;
  return { ...account.settings, accessToken: await mailAccessToken(account.credentialId) };
}

// The start of an account's fetch window, or null when it imports everything.
export function fetchWindowStart(fetchDays: number | null, now = Date.now()): Date | null {
  if (fetchDays == null) return null;
  const start = new Date(now - fetchDays * 86_400_000);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export async function setAccountStatus(
  accountId: number,
  status: 'importing' | 'synced' | 'error',
  error: string | null = null,
): Promise<void> {
  await db
    .update(mailAccount)
    .set({ syncStatus: status, syncError: error, lastSyncAt: new Date() })
    .where(eq(mailAccount.id, accountId));
}

export interface ListedFolder {
  path: string;
  name: string;
  role: FolderRole | null;
  sync: boolean;
}

// Stores the folder list the server reported and returns the rows. A folder the
// server no longer lists is removed with its locations.
export async function saveFolders(accountId: number, listed: ListedFolder[]): Promise<FolderRow[]> {
  if (listed.length > 0) {
    await db
      .insert(mailFolder)
      .values(listed.map((folder) => ({ accountId, ...folder })))
      .onConflictDoUpdate({
        target: [mailFolder.accountId, mailFolder.path],
        set: {
          name: sql`excluded.name`,
          role: sql`excluded.role`,
          sync: sql`excluded.sync`,
        },
      });
  }
  const rows = await db.select().from(mailFolder).where(eq(mailFolder.accountId, accountId));
  const paths = new Set(listed.map((folder) => folder.path));
  const gone = rows.filter((row) => !paths.has(row.path));
  const stopped = rows.filter((row) => paths.has(row.path) && !row.sync);
  for (const folder of [...gone, ...stopped]) await clearFolder(folder.id);
  if (gone.length > 0) {
    await db.delete(mailFolder).where(
      inArray(
        mailFolder.id,
        gone.map((row) => row.id),
      ),
    );
  }
  return rows.filter((row) => paths.has(row.path));
}

export async function syncedFolders(accountId: number): Promise<FolderRow[]> {
  return db
    .select()
    .from(mailFolder)
    .where(and(eq(mailFolder.accountId, accountId), eq(mailFolder.sync, true)));
}

// Removes every location of a folder, for a new UIDVALIDITY or a folder that is no
// longer imported.
export async function clearFolder(folderId: number): Promise<void> {
  const removed = await db
    .delete(mailMessageFolder)
    .where(eq(mailMessageFolder.folderId, folderId))
    .returning({ messageId: mailMessageFolder.messageId });
  await markOrphansDeleted(removed.map((row) => row.messageId));
  await db
    .update(mailFolder)
    .set({ uidValidity: null, uidNext: 0, highestModseq: null, syncedCount: 0 })
    .where(eq(mailFolder.id, folderId));
}

export async function removeLocations(folderId: number, uids: number[]): Promise<void> {
  for (let start = 0; start < uids.length; start += 1000) {
    const removed = await db
      .delete(mailMessageFolder)
      .where(
        and(
          eq(mailMessageFolder.folderId, folderId),
          inArray(mailMessageFolder.uid, uids.slice(start, start + 1000)),
        ),
      )
      .returning({ messageId: mailMessageFolder.messageId });
    await markOrphansDeleted(removed.map((row) => row.messageId));
  }
}

async function markOrphansDeleted(messageIds: number[]): Promise<void> {
  if (messageIds.length === 0) return;
  await db
    .update(mailMessage)
    .set({ deletedAt: new Date() })
    .where(
      and(
        inArray(mailMessage.id, [...new Set(messageIds)]),
        notExists(
          db
            .select({ one: sql`1` })
            .from(mailMessageFolder)
            .where(eq(mailMessageFolder.messageId, mailMessage.id)),
        ),
      ),
    );
}

// The UIDs of a folder Plan knows: its stored locations, and the messages Plan moved
// out of it whose move the server has not been told about yet.
export async function knownUids(folderId: number): Promise<Set<number>> {
  const [locations, moves] = await Promise.all([
    db
      .select({ uid: mailMessageFolder.uid })
      .from(mailMessageFolder)
      .where(eq(mailMessageFolder.folderId, folderId)),
    db
      .select({ uid: mailAction.uid })
      .from(mailAction)
      .where(
        and(eq(mailAction.folderId, folderId), inArray(mailAction.kind, ['archive', 'trash'])),
      ),
  ]);
  return new Set([...locations, ...moves].map((row) => row.uid));
}

export async function messageIdsOf(
  accountId: number,
  messageIds: string[],
): Promise<Map<string, number>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({ id: mailMessage.id, messageId: mailMessage.messageId })
    .from(mailMessage)
    .where(and(eq(mailMessage.accountId, accountId), inArray(mailMessage.messageId, messageIds)));
  return new Map(rows.map((row) => [row.messageId, row.id]));
}

export interface ServerFlags {
  seen: boolean;
  flagged: boolean;
  answered: boolean;
}

export function flagsOf(flags: Set<string> | undefined): ServerFlags {
  return {
    seen: flags?.has('\\Seen') ?? false,
    flagged: flags?.has('\\Flagged') ?? false,
    answered: flags?.has('\\Answered') ?? false,
  };
}

// Records that a stored message is in a folder under a UID, and takes the flags the
// server reports for it there.
export async function addLocation(
  folderId: number,
  uid: number,
  messageId: number,
  flags: ServerFlags,
): Promise<void> {
  await db
    .insert(mailMessageFolder)
    .values({ folderId, uid, messageId })
    .onConflictDoUpdate({
      target: [mailMessageFolder.folderId, mailMessageFolder.uid],
      set: { messageId },
    });
  await db
    .update(mailMessage)
    .set({
      deletedAt: null,
      seen: sql`CASE WHEN ${noPendingAction()} THEN ${flags.seen} ELSE ${mailMessage.seen} END`,
      flagged: sql`CASE WHEN ${noPendingAction()} THEN ${flags.flagged} ELSE ${mailMessage.flagged} END`,
      answered: sql`CASE WHEN ${noPendingAction()} THEN ${flags.answered} ELSE ${mailMessage.answered} END`,
    })
    .where(eq(mailMessage.id, messageId));
}

function noPendingAction() {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(mailAction)
      .where(eq(mailAction.messageId, mailMessage.id)),
  );
}

// Takes flag changes made on the server, except on messages with a change of Plan's
// own still waiting to be pushed.
export async function applyServerFlags(
  folderId: number,
  entries: { uid: number; flags: ServerFlags }[],
): Promise<void> {
  for (let start = 0; start < entries.length; start += 1000) {
    const rows = entries
      .slice(start, start + 1000)
      .map((entry) => ({ uid: entry.uid, ...entry.flags }));
    await db.execute(sql`
      UPDATE mail_message m
         SET seen = v.seen, flagged = v.flagged, answered = v.answered
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
               AS v(uid bigint, seen boolean, flagged boolean, answered boolean)
        JOIN mail_message_folder l ON l.folder_id = ${folderId} AND l.uid = v.uid
       WHERE m.id = l.message_id
         AND (m.seen, m.flagged, m.answered) IS DISTINCT FROM (v.seen, v.flagged, v.answered)
         AND NOT EXISTS (SELECT 1 FROM mail_action a WHERE a.message_id = m.id)
    `);
  }
}

export async function saveFolderState(
  folderId: number,
  state: {
    uidValidity: number;
    uidNext: number;
    highestModseq: string | null;
    totalCount: number;
  },
): Promise<void> {
  await db
    .update(mailFolder)
    .set({ ...state, lastSyncedAt: new Date() })
    .where(eq(mailFolder.id, folderId));
  await updateSyncedCount(folderId, state.totalCount);
}

export async function updateSyncedCount(folderId: number, totalCount?: number): Promise<void> {
  await db
    .update(mailFolder)
    .set({
      syncedCount: sql`(SELECT count(*)::int FROM mail_message_folder WHERE folder_id = ${folderId})`,
      ...(totalCount === undefined ? {} : { totalCount }),
    })
    .where(eq(mailFolder.id, folderId));
}

export async function setFolderValidity(folderId: number, uidValidity: number): Promise<void> {
  await db.update(mailFolder).set({ uidValidity }).where(eq(mailFolder.id, folderId));
}

export async function projectKeyOf(projectId: number | null): Promise<string | null> {
  if (projectId == null) return null;
  const [row] = await db
    .select({ key: project.key })
    .from(project)
    .where(eq(project.id, projectId));
  return row?.key ?? null;
}

export type ActionRow = typeof mailAction.$inferSelect;

export async function pendingActions(accountId: number): Promise<ActionRow[]> {
  return db
    .select()
    .from(mailAction)
    .where(and(eq(mailAction.accountId, accountId), lt(mailAction.attempts, 5)))
    .orderBy(asc(mailAction.id))
    .limit(200);
}

export async function accountsWithPendingActions(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ accountId: mailAction.accountId })
    .from(mailAction)
    .where(lt(mailAction.attempts, 5));
  return rows.map((row) => row.accountId);
}

export async function finishAction(id: number): Promise<void> {
  await db.delete(mailAction).where(eq(mailAction.id, id));
}

export async function failAction(id: number, error: string): Promise<void> {
  await db
    .update(mailAction)
    .set({ attempts: sql`${mailAction.attempts} + 1`, lastError: error.slice(0, 500) })
    .where(eq(mailAction.id, id));
}

// ── Fetch window and reset ────────────────────────────────────────────────────────────────

const PRUNE_EVERY_MS = 24 * 3_600_000;

// Accounts with a fetch window whose last prune is a day old, or that never pruned.
export async function accountsDueForPrune(): Promise<{ id: number; fetchDays: number }[]> {
  const rows = await db
    .select({ id: mailAccount.id, fetchDays: mailAccount.fetchDays })
    .from(mailAccount)
    .where(
      and(
        sql`${mailAccount.fetchDays} is not null`,
        sql`${mailAccount.resetRequestedAt} is null`,
        sql`(${mailAccount.prunedAt} is null or ${mailAccount.prunedAt} < ${new Date(Date.now() - PRUNE_EVERY_MS)})`,
      ),
    );
  return rows.map((row) => ({ id: row.id, fetchDays: row.fetchDays! }));
}

export async function accountsToReset(): Promise<number[]> {
  const rows = await db
    .select({ id: mailAccount.id })
    .from(mailAccount)
    .where(sql`${mailAccount.resetRequestedAt} is not null`);
  return rows.map((row) => row.id);
}

// Deletes messages with their files: the .eml in storage and the attachments in the vault
// (a folder the attachments leave empty goes too). Threads left without a message go.
async function deleteMessages(ids: number[]): Promise<number> {
  let deleted = 0;
  for (let start = 0; start < ids.length; start += 500) {
    const batch = ids.slice(start, start + 500);
    const files = await db
      .select({
        rawKey: mailMessage.rawKey,
        folder: mailMessage.attachmentFolder,
        threadId: mailMessage.threadId,
      })
      .from(mailMessage)
      .where(inArray(mailMessage.id, batch));
    const attachments = await db
      .select({ path: mailAttachment.vaultPath })
      .from(mailAttachment)
      .where(inArray(mailAttachment.messageId, batch));
    await db.delete(mailMessage).where(inArray(mailMessage.id, batch));
    deleted += batch.length;
    for (const file of files) await deleteObject(file.rawKey).catch(() => undefined);
    for (const attachment of attachments) await removeVaultFile(attachment.path);
    for (const folder of new Set(files.flatMap((file) => (file.folder ? [file.folder] : [])))) {
      await removeEmptyVaultFolder(folder);
    }
    const threads = [...new Set(files.map((file) => file.threadId))];
    if (threads.length > 0) {
      await db.delete(mailThread).where(
        and(
          inArray(mailThread.id, threads),
          notExists(
            db
              .select({ one: sql`1` })
              .from(mailMessage)
              .where(eq(mailMessage.threadId, mailThread.id)),
          ),
        ),
      );
    }
  }
  return deleted;
}

async function removeVaultFile(relative: string): Promise<void> {
  try {
    await assertNoSymlinks(relative);
    await unlink(vaultAbsolute(relative));
  } catch {
    // Moved or deleted by the owner already.
  }
}

async function removeEmptyVaultFolder(relative: string): Promise<void> {
  try {
    await assertNoSymlinks(relative);
    await rmdir(vaultAbsolute(relative));
  } catch {
    // Not empty (the owner filed something there) or gone.
  }
}

// Removes the imported copies of mail older than the fetch window. A thread a task was made
// from or links to keeps all of its mail. The mail on the server is not touched.
export async function pruneAccount(accountId: number, fetchDays: number): Promise<number> {
  const start = fetchWindowStart(fetchDays)!;
  const rows = await db
    .select({ id: mailMessage.id })
    .from(mailMessage)
    .where(
      and(
        eq(mailMessage.accountId, accountId),
        lt(mailMessage.sentAt, start),
        notExists(
          db
            .select({ one: sql`1` })
            .from(mailThreadIssue)
            .where(eq(mailThreadIssue.threadId, mailMessage.threadId)),
        ),
      ),
    );
  const deleted = await deleteMessages(rows.map((row) => row.id));
  await db.update(mailAccount).set({ prunedAt: new Date() }).where(eq(mailAccount.id, accountId));
  return deleted;
}

// "Zurücksetzen": every imported copy of the account goes (messages, threads, attachments,
// the .eml files, the folder state and pending changes), then the account imports again
// from the start. Drafts stay.
export async function wipeAccount(accountId: number): Promise<number> {
  const rows = await db
    .select({ id: mailMessage.id })
    .from(mailMessage)
    .where(eq(mailMessage.accountId, accountId));
  const deleted = await deleteMessages(rows.map((row) => row.id));
  await db.delete(mailAction).where(eq(mailAction.accountId, accountId));
  await db.delete(mailFolder).where(eq(mailFolder.accountId, accountId));
  await deleteObjectFolder(`mail/${accountId}`).catch(() => undefined);
  await db
    .update(mailAccount)
    .set({
      resetRequestedAt: null,
      prunedAt: null,
      syncStatus: 'idle',
      syncError: null,
      lastSyncAt: null,
      updatedAt: new Date(),
    })
    .where(eq(mailAccount.id, accountId));
  return deleted;
}
