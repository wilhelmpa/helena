import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import {
  db,
  mailAccount,
  mailAttachment,
  mailDraft,
  mailMessage,
  mailThread,
  user,
  type MailAddressRow,
  type MailDraftAttachment,
} from '@repo/db';
import { assertNoSymlinks, plainTextHtml, vaultAbsolute } from '@repo/mail';
import { deleteObject, putObject } from '@repo/storage';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { safeAttachmentFilename } from '#modules/attachments/storage';
import { getStorageSettings } from '#modules/settings/service';
import { HttpError, iso } from '#shared/lib';
import type { MailScope } from '../access';

export const UNDO_SECONDS = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const OPEN = ['draft', 'failed'];

export type DraftMode = 'new' | 'reply' | 'reply_all' | 'forward';
type DraftRow = typeof mailDraft.$inferSelect;
type MessageRow = typeof mailMessage.$inferSelect;

// A draft of a thread is filed where the thread is; a new mail where its account is.
const draftProject = sql<
  number | null
>`CASE WHEN ${mailDraft.threadId} IS NULL THEN ${mailAccount.projectId} ELSE ${mailThread.projectId} END`;

export async function draftAccess(draftId: number) {
  const [row] = await db
    .select({
      id: mailDraft.id,
      teamId: mailDraft.teamId,
      projectId: draftProject,
      status: mailDraft.status,
    })
    .from(mailDraft)
    .innerJoin(mailAccount, eq(mailAccount.id, mailDraft.accountId))
    .leftJoin(mailThread, eq(mailThread.id, mailDraft.threadId))
    .where(eq(mailDraft.id, draftId));
  return row ?? null;
}

async function toDtos(rows: DraftRow[]) {
  if (rows.length === 0) return [];
  const accounts = await db
    .select({ id: mailAccount.id, address: mailAccount.address })
    .from(mailAccount)
    .where(inArray(mailAccount.id, [...new Set(rows.map((row) => row.accountId))]));
  const creators = rows.flatMap((row) => (row.createdByUserId ? [row.createdByUserId] : []));
  const names =
    creators.length === 0
      ? []
      : await db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, [...new Set(creators)]));
  return rows.map((row) => ({
    id: row.id,
    teamId: row.teamId,
    accountId: row.accountId,
    accountAddress: accounts.find((account) => account.id === row.accountId)!.address,
    threadId: row.threadId,
    replyToMessageId: row.replyToMessageId,
    issueId: row.issueId,
    mode: row.mode as DraftMode,
    to: row.toAddresses,
    cc: row.ccAddresses,
    bcc: row.bccAddresses,
    subject: row.subject,
    bodyText: row.bodyText,
    bodyHtml: row.bodyHtml,
    attachments: row.attachments,
    status: row.status as 'draft' | 'pending_approval' | 'queued' | 'sending' | 'sent' | 'failed',
    sendAt: row.sendAt ? iso(row.sendAt) : null,
    lastError: row.lastError,
    createdByUserId: row.createdByUserId,
    createdByName: names.find((item) => item.id === row.createdByUserId)?.name ?? null,
    approvalRequestId: row.approvalRequestId,
    updatedAt: iso(row.updatedAt),
  }));
}

async function draftRow(draftId: number): Promise<DraftRow> {
  const [row] = await db.select().from(mailDraft).where(eq(mailDraft.id, draftId));
  if (!row) throw new HttpError(404, 'Draft not found');
  return row;
}

export async function getDraft(draftId: number) {
  return (await toDtos([await draftRow(draftId)]))[0]!;
}

// The drafts still open: being written, waiting for approval, failed, or in their
// undo time.
export async function listOpenDrafts(teamId: number, scope: MailScope) {
  const parts: SQL[] = [];
  if (scope.projectIds.length > 0) parts.push(inArray(draftProject, scope.projectIds));
  if (scope.home) parts.push(isNull(draftProject));
  if (parts.length === 0) return [];
  const rows = await db
    .select({ draft: mailDraft })
    .from(mailDraft)
    .innerJoin(mailAccount, eq(mailAccount.id, mailDraft.accountId))
    .leftJoin(mailThread, eq(mailThread.id, mailDraft.threadId))
    .where(
      and(
        eq(mailDraft.teamId, teamId),
        inArray(mailDraft.status, ['draft', 'pending_approval', 'queued', 'failed']),
        or(...parts),
      ),
    )
    .orderBy(desc(mailDraft.updatedAt))
    .limit(100);
  return toDtos(rows.map((row) => row.draft));
}

function sender(message: Pick<MessageRow, 'fromName' | 'fromAddress'>): string {
  return message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress;
}

function prefixed(subject: string, prefix: 'Re:' | 'Fwd:'): string {
  const pattern = prefix === 'Re:' ? /^(re|aw|sv):/i : /^(fwd?|wg|tr):/i;
  return pattern.test(subject.trim()) ? subject.trim() : `${prefix} ${subject.trim()}`;
}

function stamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

function unique(addresses: MailAddressRow[], skip: Set<string>): MailAddressRow[] {
  const out: MailAddressRow[] = [];
  for (const item of addresses) {
    if (!item.address || skip.has(item.address)) continue;
    skip.add(item.address);
    out.push({ name: item.name, address: item.address });
  }
  return out;
}

// Recipients, subject, quoted text and carried attachments of an answer or a forward.
export async function prefill(mode: DraftMode, message: MessageRow, ownAddress: string) {
  const own = ownAddress.toLowerCase();
  if (mode === 'forward') {
    const files = await db
      .select()
      .from(mailAttachment)
      .where(eq(mailAttachment.messageId, message.id))
      .orderBy(asc(mailAttachment.id));
    const header = [
      '---------- Forwarded message ----------',
      `From: ${sender(message)}`,
      `Date: ${stamp(message.sentAt)} UTC`,
      `Subject: ${message.subject}`,
      `To: ${message.toAddresses.map((item) => item.address).join(', ')}`,
    ];
    return {
      to: [],
      cc: [],
      subject: prefixed(message.subject, 'Fwd:'),
      quote: `${header.join('\n')}\n\n${message.textBody.trim()}`,
      attachments: files.map((file): MailDraftAttachment => ({
        source: 'vault',
        ref: file.vaultPath,
        filename: file.filename,
        contentType: file.contentType,
        size: file.size,
      })),
    };
  }
  const author =
    message.replyTo.length > 0
      ? message.replyTo
      : [{ name: message.fromName, address: message.fromAddress }];
  const to = unique(message.fromAddress === own ? message.toAddresses : author, new Set([own]));
  const cc =
    mode === 'reply_all'
      ? unique(
          [...message.toAddresses, ...message.ccAddresses],
          new Set([own, ...to.map((item) => item.address)]),
        )
      : [];
  const quoted = message.textBody
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return {
    to,
    cc,
    subject: prefixed(message.subject, 'Re:'),
    quote: `${sender(message)}, ${stamp(message.sentAt)} UTC:\n${quoted}`,
    attachments: [] as MailDraftAttachment[],
  };
}

export async function messageRow(messageId: number): Promise<MessageRow> {
  const [row] = await db.select().from(mailMessage).where(eq(mailMessage.id, messageId));
  if (!row) throw new HttpError(404, 'Mail message not found');
  return row;
}

export async function accountRow(teamId: number, accountId: number) {
  const [row] = await db
    .select()
    .from(mailAccount)
    .where(and(eq(mailAccount.id, accountId), eq(mailAccount.teamId, teamId)));
  if (!row) throw new HttpError(404, 'Mail account not found');
  return row;
}

export async function createDraft(input: {
  teamId: number;
  userId: string;
  mode: DraftMode;
  accountId: number;
  message: MessageRow | null;
  issueId?: number;
  to?: MailAddressRow[];
  body?: string;
}) {
  const account = await accountRow(input.teamId, input.accountId);
  const filled = input.message ? await prefill(input.mode, input.message, account.address) : null;
  const bodyText = [input.body?.trim(), filled?.quote].filter(Boolean).join('\n\n');
  const [row] = await db
    .insert(mailDraft)
    .values({
      teamId: input.teamId,
      accountId: account.id,
      createdByUserId: input.userId,
      threadId: input.message?.threadId ?? null,
      replyToMessageId: input.message && input.mode !== 'forward' ? input.message.id : null,
      issueId: input.issueId ?? null,
      mode: input.mode,
      toAddresses: input.to ?? filled?.to ?? [],
      ccAddresses: filled?.cc ?? [],
      subject: filled?.subject ?? '',
      bodyText,
      bodyHtml: bodyText ? plainTextHtml(bodyText) : '',
      attachments: filled?.attachments ?? [],
    })
    .returning();
  return (await toDtos([row!]))[0]!;
}

async function assertOpen(row: DraftRow): Promise<void> {
  if (!OPEN.includes(row.status)) {
    throw new HttpError(409, 'The draft is being sent or waits for approval');
  }
}

export async function updateDraft(
  draftId: number,
  input: {
    accountId?: number;
    to?: MailAddressRow[];
    cc?: MailAddressRow[];
    bcc?: MailAddressRow[];
    subject?: string;
    bodyText?: string;
    bodyHtml?: string;
    attachments?: { source: 'storage' | 'vault'; ref: string }[];
  },
) {
  const row = await draftRow(draftId);
  await assertOpen(row);
  const { attachments, to, cc, bcc, ...fields } = input;
  let kept = row.attachments;
  if (attachments) {
    const wanted = new Set(attachments.map((item) => `${item.source}\0${item.ref}`));
    kept = row.attachments.filter((item) => wanted.has(`${item.source}\0${item.ref}`));
    for (const item of row.attachments) {
      if (item.source === 'storage' && !kept.includes(item))
        await deleteObject(item.ref).catch(() => undefined);
    }
  }
  const [updated] = await db
    .update(mailDraft)
    .set({
      ...fields,
      ...(to ? { toAddresses: to } : {}),
      ...(cc ? { ccAddresses: cc } : {}),
      ...(bcc ? { bccAddresses: bcc } : {}),
      attachments: kept,
      status: 'draft',
      updatedAt: new Date(),
    })
    .where(eq(mailDraft.id, draftId))
    .returning();
  return (await toDtos([updated!]))[0]!;
}

export async function deleteDraft(draftId: number): Promise<void> {
  const row = await draftRow(draftId);
  if (row.status === 'queued' || row.status === 'sending') {
    throw new HttpError(409, 'Undo the send before discarding the draft');
  }
  await db.delete(mailDraft).where(eq(mailDraft.id, draftId));
  for (const item of row.attachments) {
    if (item.source === 'storage') await deleteObject(item.ref).catch(() => undefined);
  }
}

async function addAttachment(row: DraftRow, attachment: MailDraftAttachment) {
  await assertOpen(row);
  const total = row.attachments.reduce((sum, item) => sum + item.size, 0) + attachment.size;
  if (total > MAX_TOTAL_BYTES) throw new HttpError(413, 'The attachments exceed 25 MB');
  const [updated] = await db
    .update(mailDraft)
    .set({ attachments: [...row.attachments, attachment], updatedAt: new Date() })
    .where(eq(mailDraft.id, row.id))
    .returning();
  return (await toDtos([updated!]))[0]!;
}

export async function uploadAttachment(draftId: number, file: File) {
  const row = await draftRow(draftId);
  await assertOpen(row);
  if (file.size === 0) throw new HttpError(400, 'Uploaded file is empty');
  const { maxAttachmentMb } = await getStorageSettings();
  if (file.size > maxAttachmentMb * 1024 * 1024)
    throw new HttpError(413, `The file exceeds ${maxAttachmentMb} MB`);
  const filename = safeAttachmentFilename(file.name);
  const contentType = file.type.split(';')[0] || 'application/octet-stream';
  const key = `mail/drafts/${draftId}/${randomUUID()}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), contentType);
  try {
    return await addAttachment(row, {
      source: 'storage',
      ref: key,
      filename,
      contentType,
      size: file.size,
    });
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }
}

// A vault file attached by path. The caller has checked that its place is one they
// may read.
export async function attachVaultFile(draftId: number, vaultPath: string) {
  const row = await draftRow(draftId);
  let absolute: string;
  try {
    absolute = vaultAbsolute(vaultPath);
    await assertNoSymlinks(vaultPath);
  } catch {
    throw new HttpError(400, 'The path is invalid');
  }
  const info = await lstat(absolute).catch(() => null);
  if (!info || !info.isFile()) throw new HttpError(404, 'The file is not in the vault');
  const filename = vaultPath.slice(vaultPath.lastIndexOf('/') + 1);
  const contentType = Bun.file(absolute).type.split(';')[0] || 'application/octet-stream';
  return addAttachment(row, {
    source: 'vault',
    ref: vaultPath,
    filename,
    contentType,
    size: info.size,
  });
}

// Hands the draft to the worker, which sends it once the undo time is over.
export async function queueDraft(draftId: number) {
  const row = await draftRow(draftId);
  await assertOpen(row);
  if (row.toAddresses.length + row.ccAddresses.length + row.bccAddresses.length === 0) {
    throw new HttpError(400, 'Add a recipient');
  }
  const [account] = await db.select().from(mailAccount).where(eq(mailAccount.id, row.accountId));
  if (!account?.passwordCiphertext) throw new HttpError(400, 'The account has no password');
  if (!account.enabled) throw new HttpError(400, 'The account is switched off');
  const [updated] = await db
    .update(mailDraft)
    .set({
      status: 'queued',
      sendAt: new Date(Date.now() + UNDO_SECONDS * 1000),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(mailDraft.id, draftId), inArray(mailDraft.status, OPEN)))
    .returning();
  if (!updated) throw new HttpError(409, 'The draft is being sent or waits for approval');
  return (await toDtos([updated]))[0]!;
}

export async function undoSend(draftId: number) {
  const [updated] = await db
    .update(mailDraft)
    .set({ status: 'draft', sendAt: null, updatedAt: new Date() })
    .where(and(eq(mailDraft.id, draftId), eq(mailDraft.status, 'queued')))
    .returning();
  if (!updated) throw new HttpError(409, 'The mail is already on its way');
  return (await toDtos([updated]))[0]!;
}

export async function markPendingApproval(draftId: number, approvalId: number) {
  const [updated] = await db
    .update(mailDraft)
    .set({ status: 'pending_approval', approvalRequestId: approvalId, updatedAt: new Date() })
    .where(and(eq(mailDraft.id, draftId), inArray(mailDraft.status, OPEN)))
    .returning();
  if (!updated) throw new HttpError(409, 'The draft is being sent or waits for approval');
  return updated;
}

export async function draftForApproval(draftId: number) {
  const row = await draftRow(draftId);
  await assertOpen(row);
  const recipients = [...row.toAddresses, ...row.ccAddresses, ...row.bccAddresses];
  if (recipients.length === 0) throw new HttpError(400, 'Add a recipient');
  const [account] = await db.select().from(mailAccount).where(eq(mailAccount.id, row.accountId));
  const list = (items: MailAddressRow[]) => items.map((item) => item.address).join(', ');
  const details = [
    `From: ${account!.address}`,
    `To: ${list(row.toAddresses)}`,
    ...(row.ccAddresses.length > 0 ? [`Cc: ${list(row.ccAddresses)}`] : []),
    ...(row.bccAddresses.length > 0 ? [`Bcc: ${list(row.bccAddresses)}`] : []),
    `Subject: ${row.subject}`,
    ...(row.attachments.length > 0
      ? [`Attachments: ${row.attachments.map((item) => item.filename).join(', ')}`]
      : []),
    '',
    row.bodyText,
  ].join('\n');
  return {
    row,
    action: `Send the mail "${row.subject}" to ${list(recipients)}`.slice(0, 300),
    details: details.slice(0, 8000),
  };
}

// The message an answer to a thread of the project replies to: its newest.
export async function latestThreadMessage(
  threadId: number,
  projectId: number,
): Promise<MessageRow> {
  const [row] = await db
    .select({ message: mailMessage })
    .from(mailMessage)
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .where(
      and(
        eq(mailMessage.threadId, threadId),
        eq(mailThread.projectId, projectId),
        isNull(mailMessage.deletedAt),
      ),
    )
    .orderBy(desc(mailMessage.sentAt), desc(mailMessage.id))
    .limit(1);
  if (!row) throw new HttpError(404, 'Mail thread not found');
  return row.message;
}
