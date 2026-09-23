import { decryptSecret, encryptSecret } from '@repo/crypto';
import { db, mailAccount, mailFolder, mailRule, mailMessage, mailThread, project } from '@repo/db';
import { testImapConnection, testSmtpConnection, type MailServerSettings } from '@repo/mail';
import { assertPublicHttpUrl, UrlNotAllowedError } from '@repo/net';
import { deleteObjectFolder } from '@repo/storage';
import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { HttpError, iso, rethrowDuplicate } from '#shared/lib';
import { moveThread } from '../threads/move';

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
  password: string;
  enabled?: boolean;
  syncTrash?: boolean;
  syncSpam?: boolean;
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
  return rows.map((row) => {
    const owner = projects.find((item) => item.id === row.projectId);
    const counts = progress.find((item) => item.accountId === row.id);
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
      hasPassword: row.passwordCiphertext != null,
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

function passwordColumns(password: string) {
  const secret = encryptSecret(password);
  return {
    passwordCiphertext: secret.ciphertext,
    passwordIv: secret.iv,
    passwordAuthTag: secret.authTag,
  };
}

export async function createAccount(teamId: number, input: NewAccountInput) {
  await assertTeamProject(teamId, input.projectId);
  await assertMailHost(input.imapHost);
  await assertMailHost(input.smtpHost);
  const { password, ...fields } = input;
  try {
    const [row] = await db
      .insert(mailAccount)
      .values({
        ...fields,
        teamId,
        address: input.address.toLowerCase(),
        ...passwordColumns(password),
      })
      .returning();
    return (await toDto([row!]))[0]!;
  } catch (error) {
    rethrowDuplicate(error, 'mail account');
  }
}

export async function updateAccount(teamId: number, accountId: number, input: AccountInput) {
  const current = await accountRow(teamId, accountId);
  await assertTeamProject(teamId, input.projectId);
  if (input.imapHost && input.imapHost !== current.imapHost) await assertMailHost(input.imapHost);
  if (input.smtpHost && input.smtpHost !== current.smtpHost) await assertMailHost(input.smtpHost);
  const { password, ...fields } = input;
  try {
    const [row] = await db
      .update(mailAccount)
      .set({
        ...fields,
        ...(fields.address ? { address: fields.address.toLowerCase() } : {}),
        ...(password ? passwordColumns(password) : {}),
        // A new setting is a reason to connect again, so an old error no longer holds.
        ...(password || fields.imapHost || fields.imapPort || fields.username
          ? { syncStatus: 'idle', syncError: null }
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

export function accountSettings(row: AccountRow): MailServerSettings | null {
  if (!row.passwordCiphertext || !row.passwordIv || !row.passwordAuthTag) return null;
  return {
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapTls: row.imapTls,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpTls: row.smtpTls,
    username: row.username,
    password: decryptSecret({
      ciphertext: row.passwordCiphertext,
      iv: row.passwordIv,
      authTag: row.passwordAuthTag,
    }),
  };
}

export async function testConnection(
  teamId: number,
  input: Omit<MailServerSettings, 'password'> & { password?: string; accountId?: number },
): Promise<{ imap: string | null; smtp: string | null }> {
  let password = input.password;
  if (!password && input.accountId) {
    password = accountSettings(await accountRow(teamId, input.accountId))?.password;
  }
  if (!password) throw new HttpError(400, 'Enter the password');
  await assertMailHost(input.imapHost);
  await assertMailHost(input.smtpHost);
  const settings = { ...input, password };
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
