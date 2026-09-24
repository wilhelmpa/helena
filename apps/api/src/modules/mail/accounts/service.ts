import { decryptSecret } from '@repo/crypto';
import {
  db,
  integrationCredential,
  mailAccount,
  mailFolder,
  mailRule,
  mailMessage,
  mailThread,
  project,
} from '@repo/db';
import { testImapConnection, testSmtpConnection, type MailServerSettings } from '@repo/mail';
import { assertPublicHttpUrl, UrlNotAllowedError } from '@repo/net';
import { deleteObjectFolder } from '@repo/storage';
import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  createCredentialEntry,
  getCredentialEntry,
  updateCredentialEntry,
} from '#modules/agents/credentials/service';
import { HttpError, iso, rethrowDuplicate } from '#shared/lib';
import { moveThread } from '../threads/move';
import { getAccount as getAccount_ } from '#modules/connectors/store';
import { googleAccountAccessToken } from '#modules/connectors/google/engine';

type AccountRow = typeof mailAccount.$inferSelect;

export interface NewAccountInput {
  name: string;
  address: string;
  projectId: number | null;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  username: string;
  // The password: typed here, it is stored as a new secret of the Credentials page;
  // credentialId picks a secret that is there already.
  password?: string;
  credentialId?: number;
  enabled?: boolean;
  syncTrash?: boolean;
  syncSpam?: boolean;
  fetchDays?: number | null;
}

export type AccountInput = Partial<NewAccountInput>;

async function toDto(rows: AccountRow[]) {
  if (rows.length === 0) return [];
  const progress = await db
    .select({
      accountId: mailFolder.accountId,
      synced: sql<number>`coalesce(sum(${mailFolder.syncedCount}), 0)::int`,
      total: sql<number>`coalesce(sum(${mailFolder.totalCount}), 0)::int`,
    })
    .from(mailFolder)
    .where(
      and(
        eq(mailFolder.sync, true),
        inArray(
          mailFolder.accountId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .groupBy(mailFolder.accountId);
  const projects = await db
    .select({ id: project.id, key: project.key, name: project.name })
    .from(project)
    .where(eq(project.teamId, rows[0]!.teamId));
  const credentialIds = rows.flatMap((row) => (row.credentialId ? [row.credentialId] : []));
  const credentials =
    credentialIds.length === 0
      ? []
      : await db
          .select({ id: integrationCredential.id, label: integrationCredential.label })
          .from(integrationCredential)
          .where(inArray(integrationCredential.id, credentialIds));
  return rows.map((row) => {
    const owner = projects.find((item) => item.id === row.projectId);
    const counts = progress.find((item) => item.accountId === row.id);
    const credential = credentials.find((item) => item.id === row.credentialId);
    return {
      id: row.id,
      teamId: row.teamId,
      projectId: row.projectId,
      projectKey: owner?.key ?? null,
      projectName: owner?.name ?? null,
      name: row.name,
      address: row.address,
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapTls: row.imapTls,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpTls: row.smtpTls,
      username: row.username,
      hasPassword: row.credentialId != null,
      auth: row.auth === 'xoauth2' ? ('xoauth2' as const) : ('password' as const),
      googleAccountId: row.auth === 'xoauth2' ? row.credentialId : null,
      fetchDays: row.fetchDays,
      resetPending: row.resetRequestedAt != null,
      credentialId: row.credentialId,
      credentialLabel: credential?.label ?? null,
      enabled: row.enabled,
      syncTrash: row.syncTrash,
      syncSpam: row.syncSpam,
      syncStatus: row.syncStatus as 'idle' | 'importing' | 'synced' | 'error',
      syncError: row.syncError,
      lastSyncAt: row.lastSyncAt ? iso(row.lastSyncAt) : null,
      progress: { synced: counts?.synced ?? 0, total: counts?.total ?? 0 },
    };
  });
}

export async function listAccounts(teamId: number, projectId?: number) {
  const where: SQL[] = [eq(mailAccount.teamId, teamId)];
  if (projectId !== undefined) where.push(eq(mailAccount.projectId, projectId));
  const rows = await db
    .select()
    .from(mailAccount)
    .where(and(...where))
    .orderBy(asc(mailAccount.name), asc(mailAccount.id));
  return toDto(rows);
}

async function accountRow(teamId: number, accountId: number): Promise<AccountRow> {
  const [row] = await db
    .select()
    .from(mailAccount)
    .where(and(eq(mailAccount.id, accountId), eq(mailAccount.teamId, teamId)));
  if (!row) throw new HttpError(404, 'Mail account not found');
  return row;
}

export async function getAccount(teamId: number, accountId: number) {
  return (await toDto([await accountRow(teamId, accountId)]))[0]!;
}

// A mail server the api or the worker connects to must not be an address of this
// machine's own network, unless SSRF_ALLOWED_HOSTS names it.
async function assertMailHost(host: string): Promise<void> {
  try {
    await assertPublicHttpUrl(`https://${host}/`);
  } catch (error) {
    if (error instanceof UrlNotAllowedError) {
      throw new HttpError(400, `The mail server ${host} is not allowed: ${error.message}`);
    }
    throw error;
  }
}

async function assertTeamProject(teamId: number, projectId: number | null | undefined) {
  if (projectId == null) return;
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)));
  if (!row) throw new HttpError(400, 'The project must belong to this team');
}

// A secret of the Credentials page may hold the password when it belongs to the team and
// is not limited to another project.
async function assertMailCredential(
  teamId: number,
  credentialId: number,
  projectId: number | null,
): Promise<void> {
  const entry = await getCredentialEntry(credentialId, teamId);
  if (!entry || entry.kind !== 'secret') {
    throw new HttpError(400, 'Choose a secret of the Credentials page');
  }
  if (entry.projectId != null && entry.projectId !== projectId) {
    throw new HttpError(400, 'The secret is limited to another project');
  }
}

function passwordCredential(
  teamId: number,
  address: string,
  projectId: number | null,
  password: string,
) {
  return createCredentialEntry(teamId, {
    kind: 'secret',
    label: `Mail: ${address}`,
    projectId,
    value: password,
  });
}

export async function createAccount(teamId: number, input: NewAccountInput) {
  await assertTeamProject(teamId, input.projectId);
  await assertMailHost(input.imapHost);
  await assertMailHost(input.smtpHost);
  const { password, credentialId, ...fields } = input;
  const address = input.address.toLowerCase();
  if (credentialId != null) await assertMailCredential(teamId, credentialId, input.projectId);
  else if (!password) throw new HttpError(400, 'Enter the password or choose a secret');
  const [taken] = await db
    .select({ id: mailAccount.id })
    .from(mailAccount)
    .where(and(eq(mailAccount.teamId, teamId), eq(mailAccount.address, address)));
  if (taken) throw new HttpError(409, 'A mail account with this address already exists.');
  const credential =
    credentialId ?? (await passwordCredential(teamId, address, input.projectId, password!)).id;
  try {
    const [row] = await db
      .insert(mailAccount)
      .values({ ...fields, teamId, address, credentialId: credential })
      .returning();
    return (await toDto([row!]))[0]!;
  } catch (error) {
    rethrowDuplicate(error, 'mail account');
  }
}

// The fields of a Google account's mailbox that stay the owner's to change; its servers and
// login belong to the account.
const OAUTH_EDITABLE = new Set([
  'name',
  'projectId',
  'enabled',
  'syncTrash',
  'syncSpam',
  'fetchDays',
]);

export async function updateAccount(teamId: number, accountId: number, input: AccountInput) {
  const current = await accountRow(teamId, accountId);
  if (current.auth === 'xoauth2') {
    const locked = Object.keys(input).filter(
      (key) => input[key as keyof AccountInput] !== undefined && !OAUTH_EDITABLE.has(key),
    );
    if (locked.length > 0) {
      throw new HttpError(
        400,
        `This mailbox signs in with its Google account; ${locked.join(', ')} cannot be changed here.`,
      );
    }
  }
  await assertTeamProject(teamId, input.projectId);
  if (input.imapHost && input.imapHost !== current.imapHost) await assertMailHost(input.imapHost);
  if (input.smtpHost && input.smtpHost !== current.smtpHost) await assertMailHost(input.smtpHost);
  const { password, credentialId: chosen, ...fields } = input;
  const projectId = input.projectId === undefined ? current.projectId : input.projectId;
  const address = fields.address?.toLowerCase() ?? current.address;
  if (chosen != null) await assertMailCredential(teamId, chosen, projectId);
  let credentialId = chosen ?? current.credentialId;
  const linked = credentialId == null ? null : await getCredentialEntry(credentialId, teamId);
  if (password) {
    if (linked?.kind === 'secret')
      await updateCredentialEntry(linked.id, teamId, { value: password });
    else credentialId = (await passwordCredential(teamId, address, projectId, password)).id;
  }
  // The secret made for the account moves along when the account changes project.
  if (
    linked?.kind === 'secret' &&
    linked.projectId != null &&
    linked.projectId === current.projectId &&
    projectId !== current.projectId
  ) {
    await updateCredentialEntry(linked.id, teamId, { projectId });
  }
  try {
    const [row] = await db
      .update(mailAccount)
      .set({
        ...fields,
        address,
        credentialId,
        // A new setting is a reason to connect again, so an old error no longer holds.
        ...(password || chosen || fields.imapHost || fields.imapPort || fields.username
          ? { syncStatus: 'idle', syncError: null }
          : {}),
        // A new fetch window is pruned to at once.
        ...(fields.fetchDays !== undefined && fields.fetchDays !== current.fetchDays
          ? { prunedAt: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(mailAccount.id, current.id))
      .returning();
    return (await toDto([row!]))[0]!;
  } catch (error) {
    rethrowDuplicate(error, 'mail account');
  }
}

// The imported mail goes with the account; files it put into the vault stay there.
export async function deleteAccount(teamId: number, accountId: number): Promise<void> {
  const current = await accountRow(teamId, accountId);
  await db.delete(mailAccount).where(eq(mailAccount.id, current.id));
  await deleteObjectFolder(`mail/${current.id}`).catch((error) => {
    console.error(`[planner] failed to delete the stored mail of account ${current.id}:`, error);
  });
}

// "Zurücksetzen": the worker wipes every imported copy of the account (messages, threads,
// attachments, the stored .eml files) and imports again within its fetch window. The mail
// on the server is not touched.
export async function resetAccount(teamId: number, accountId: number) {
  const current = await accountRow(teamId, accountId);
  const [row] = await db
    .update(mailAccount)
    .set({
      resetRequestedAt: new Date(),
      syncStatus: 'idle',
      syncError: null,
      updatedAt: new Date(),
    })
    .where(eq(mailAccount.id, current.id))
    .returning();
  return (await toDto([row!]))[0]!;
}

// The password a secret of the credential store holds.
async function secretValue(credentialId: number): Promise<string | null> {
  const [credential] = await db
    .select({
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .where(eq(integrationCredential.id, credentialId));
  if (!credential) return null;
  return (JSON.parse(decryptSecret(credential)) as { value?: string }).value ?? null;
}

export async function testConnection(
  teamId: number,
  input: Omit<MailServerSettings, 'password'> & {
    password?: string;
    credentialId?: number;
    accountId?: number;
  },
): Promise<{ imap: string | null; smtp: string | null }> {
  const { credentialId: chosen, accountId, ...servers } = input;
  if (accountId && !input.password && chosen == null) {
    const current = await accountRow(teamId, accountId);
    if (current.auth === 'xoauth2') return testOAuthAccount(teamId, current);
  }
  let password = input.password;
  let credentialId = chosen;
  if (!password && credentialId == null && accountId) {
    credentialId = (await accountRow(teamId, accountId)).credentialId ?? undefined;
  } else if (!password && credentialId != null) {
    const entry = await getCredentialEntry(credentialId, teamId);
    if (entry?.kind !== 'secret')
      throw new HttpError(400, 'Choose a secret of the Credentials page');
  }
  if (!password && credentialId != null) password = (await secretValue(credentialId)) ?? undefined;
  if (!password) throw new HttpError(400, 'Enter the password');
  await assertMailHost(input.imapHost);
  await assertMailHost(input.smtpHost);
  const settings = { ...servers, password };
  const [imap, smtp] = await Promise.all([
    testImapConnection(settings),
    testSmtpConnection(settings),
  ]);
  return { imap, smtp };
}

// A Google account's mailbox logs in to Gmail's IMAP and SMTP with the account's token.
async function testOAuthAccount(
  teamId: number,
  row: AccountRow,
): Promise<{ imap: string | null; smtp: string | null }> {
  const account =
    row.credentialId == null ? null : await getAccount_(row.credentialId, teamId, ['google']);
  if (!account) return { imap: 'The Google account is gone.', smtp: 'The Google account is gone.' };
  let accessToken: string;
  try {
    accessToken = await googleAccountAccessToken(account);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google sign-in failed.';
    return { imap: message, smtp: message };
  }
  const settings = {
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapTls: row.imapTls,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpTls: row.smtpTls,
    username: row.username,
    accessToken,
  };
  const [imap, smtp] = await Promise.all([
    testImapConnection(settings),
    testSmtpConnection(settings),
  ]);
  return { imap, smtp };
}

type RuleRow = typeof mailRule.$inferSelect;

async function ruleDtos(rows: RuleRow[]) {
  if (rows.length === 0) return [];
  const projects = await db
    .select({ id: project.id, key: project.key, name: project.name })
    .from(project)
    .where(eq(project.teamId, rows[0]!.teamId));
  return rows.map((row) => {
    const target = projects.find((item) => item.id === row.projectId)!;
    return {
      id: row.id,
      accountId: row.accountId,
      matchType: row.matchType as 'address' | 'domain',
      value: row.value,
      projectId: row.projectId,
      projectKey: target.key,
      projectName: target.name,
    };
  });
}

export async function listRules(teamId: number) {
  const rows = await db
    .select()
    .from(mailRule)
    .where(eq(mailRule.teamId, teamId))
    .orderBy(asc(mailRule.value), asc(mailRule.id));
  return ruleDtos(rows);
}

export async function createRule(
  teamId: number,
  input: {
    accountId: number | null;
    matchType: 'address' | 'domain';
    value: string;
    projectId: number;
    applyToExisting?: boolean;
  },
) {
  await assertTeamProject(teamId, input.projectId);
  if (input.accountId != null) await accountRow(teamId, input.accountId);
  const value = input.value.trim().toLowerCase().replace(/^@/, '');
  if (
    input.matchType === 'address'
      ? !/^[^\s@]+@[^\s@]+$/.test(value)
      : !/^[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    throw new HttpError(400, `The ${input.matchType} is invalid`);
  }
  const [row] = await db
    .insert(mailRule)
    .values({
      teamId,
      accountId: input.accountId,
      matchType: input.matchType,
      value,
      projectId: input.projectId,
    })
    .returning();
  const movedThreads = input.applyToExisting ? await applyRule(row!) : 0;
  return { rule: (await ruleDtos([row!]))[0]!, movedThreads };
}

// Moves the threads a rule matches into its project: those with a message from the
// address or domain, other than mail the account sent itself.
async function applyRule(rule: RuleRow): Promise<number> {
  const sender =
    rule.matchType === 'address'
      ? sql`m.from_address = ${rule.value}`
      : sql`split_part(m.from_address, '@', 2) = ${rule.value}`;
  const rows = await db
    .select({ id: mailThread.id })
    .from(mailThread)
    .innerJoin(mailAccount, eq(mailAccount.id, mailThread.accountId))
    .where(
      and(
        eq(mailThread.teamId, rule.teamId),
        rule.accountId == null ? undefined : eq(mailThread.accountId, rule.accountId),
        or(isNull(mailThread.projectId), ne(mailThread.projectId, rule.projectId)),
        sql`EXISTS (SELECT 1 FROM ${mailMessage} m WHERE m.thread_id = ${mailThread.id} AND m.from_address <> ${mailAccount.address} AND ${sender})`,
      ),
    );
  for (const row of rows) await moveThread(row.id, rule.projectId);
  return rows.length;
}

export async function deleteRule(teamId: number, ruleId: number): Promise<void> {
  const rows = await db
    .delete(mailRule)
    .where(and(eq(mailRule.id, ruleId), eq(mailRule.teamId, teamId)))
    .returning({ id: mailRule.id });
  if (rows.length === 0) throw new HttpError(404, 'Mail rule not found');
}
