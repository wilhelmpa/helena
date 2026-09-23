import {
  db,
  issue,
  mailAccount,
  mailAction,
  mailAttachment,
  mailContact,
  mailDraft,
  mailFolder,
  mailMessage,
  mailMessageFolder,
  mailThread,
  mailThreadIssue,
  project,
  user,
  type MailAddressRow,
} from '@repo/db';
import { allowRemoteImages, findInlinePart, resolveCidImages, vaultAbsolute } from '@repo/mail';
import { getObject } from '@repo/storage';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { HttpError, iso } from '#shared/lib';
import type { MailScope } from '../access';

export type FolderRoleFilter = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'junk' | 'all';

export interface ThreadCursor {
  ts: string;
  id: number;
}

export interface ThreadFilters {
  teamId: number;
  scope: MailScope;
  projectId?: number;
  home?: boolean;
  accountId?: number;
  folderId?: number;
  role?: FolderRoleFilter;
  unread?: boolean;
  attachments?: boolean;
  flagged?: boolean;
  q?: string;
  cursor?: ThreadCursor | null;
  limit?: number;
}

// Each word the owner typed becomes a prefix match, so the list narrows while typing.
// An address splits at the @, so "anna@ver" finds anna@verve.example.
export function searchQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .split(/[\s@]+/)
    .map((word) => word.replace(/['\\:&|!()<>*]/g, ''))
    .filter(Boolean)
    .slice(0, 8);
  return words.length > 0 ? words.map((word) => `'${word}':*`).join(' & ') : null;
}

export function parseCursor(value?: string): ThreadCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ThreadCursor>;
    if (typeof parsed.ts === 'string' && Number.isInteger(parsed.id)) {
      if (Number.isFinite(new Date(parsed.ts).getTime())) return { ts: parsed.ts, id: parsed.id! };
    }
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Invalid cursor');
}

function scopeCondition(scope: MailScope): SQL {
  const parts: SQL[] = [];
  if (scope.projectIds.length > 0) parts.push(inArray(mailThread.projectId, scope.projectIds));
  if (scope.home) parts.push(isNull(mailThread.projectId));
  return parts.length > 0 ? or(...parts)! : sql`false`;
}

const suggested = alias(project, 'suggested_project');

export async function listThreads(filters: ThreadFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const where: SQL[] = [eq(mailThread.teamId, filters.teamId), scopeCondition(filters.scope)];
  if (filters.projectId !== undefined) where.push(eq(mailThread.projectId, filters.projectId));
  if (filters.home) where.push(isNull(mailThread.projectId));
  if (filters.accountId !== undefined) where.push(eq(mailThread.accountId, filters.accountId));
  if (filters.cursor) {
    const ts = new Date(filters.cursor.ts);
    where.push(
      or(
        lt(mailThread.lastMessageAt, ts),
        and(eq(mailThread.lastMessageAt, ts), lt(mailThread.id, filters.cursor.id)),
      )!,
    );
  }
  const messageWhere: SQL[] = [
    eq(mailMessage.threadId, mailThread.id),
    isNull(mailMessage.deletedAt),
  ];
  if (filters.unread) messageWhere.push(eq(mailMessage.seen, false));
  if (filters.attachments) messageWhere.push(eq(mailMessage.hasAttachments, true));
  if (filters.flagged) messageWhere.push(eq(mailMessage.flagged, true));
  const query = filters.q ? searchQuery(filters.q) : null;
  if (query) messageWhere.push(sql`${mailMessage.search} @@ to_tsquery('simple', ${query})`);
  if (filters.folderId !== undefined || (filters.role && filters.role !== 'all')) {
    messageWhere.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(mailMessageFolder)
          .innerJoin(mailFolder, eq(mailFolder.id, mailMessageFolder.folderId))
          .where(
            and(
              eq(mailMessageFolder.messageId, mailMessage.id),
              filters.folderId !== undefined
                ? eq(mailFolder.id, filters.folderId)
                : eq(mailFolder.role, filters.role!),
            ),
          ),
      ),
    );
  }
  where.push(
    exists(
      db
        .select({ one: sql`1` })
        .from(mailMessage)
        .where(and(...messageWhere)),
    ),
  );

  const live = sql`m.thread_id = ${mailThread.id} AND m.deleted_at IS NULL`;
  const rows = await db
    .select({
      id: mailThread.id,
      accountId: mailThread.accountId,
      accountAddress: mailAccount.address,
      accountName: mailAccount.name,
      projectId: mailThread.projectId,
      projectKey: project.key,
      suggestedProjectId: mailThread.suggestedProjectId,
      suggestedProjectKey: suggested.key,
      subject: mailThread.subject,
      lastMessageAt: mailThread.lastMessageAt,
      fromName: mailThread.lastFromName,
      fromAddress: mailThread.lastFromAddress,
      snippet: mailThread.snippet,
      messageCount: sql<number>`(SELECT count(*)::int FROM mail_message m WHERE ${live})`,
      unread: sql<boolean>`EXISTS (SELECT 1 FROM mail_message m WHERE ${live} AND NOT m.seen)`,
      flagged: sql<boolean>`EXISTS (SELECT 1 FROM mail_message m WHERE ${live} AND m.flagged)`,
      hasAttachments: sql<boolean>`EXISTS (SELECT 1 FROM mail_message m WHERE ${live} AND m.has_attachments)`,
    })
    .from(mailThread)
    .innerJoin(mailAccount, eq(mailAccount.id, mailThread.accountId))
    .leftJoin(project, eq(project.id, mailThread.projectId))
    .leftJoin(suggested, eq(suggested.id, mailThread.suggestedProjectId))
    .where(and(...where))
    .orderBy(desc(mailThread.lastMessageAt), desc(mailThread.id))
    .limit(limit + 1);
  const page = rows
    .slice(0, limit)
    .map((row) => ({ ...row, lastMessageAt: iso(row.lastMessageAt) }));
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      rows.length > limit && last ? JSON.stringify({ ts: last.lastMessageAt, id: last.id }) : null,
  };
}

export async function listFolders(accountIds: number[]) {
  if (accountIds.length === 0) return [];
  return db
    .select({
      id: mailFolder.id,
      accountId: mailFolder.accountId,
      path: mailFolder.path,
      name: mailFolder.name,
      role: mailFolder.role,
    })
    .from(mailFolder)
    .where(and(inArray(mailFolder.accountId, accountIds), eq(mailFolder.sync, true)))
    .orderBy(asc(mailFolder.accountId), asc(mailFolder.path));
}

// The HTML of a message as the reading pane shows it: cid: images point at the part
// route (relative, the pane sets the api as its base URL) and remote images load only
// once the owner allowed them for this message.
function readableHtml(message: {
  id: number;
  htmlBody: string | null;
  allowRemoteImages: boolean;
}) {
  if (!message.htmlBody) return null;
  const resolved = resolveCidImages(
    message.htmlBody,
    (cid) => `mail/messages/${message.id}/parts/${encodeURIComponent(cid)}`,
  );
  return message.allowRemoteImages ? allowRemoteImages(resolved) : resolved;
}

function addresses(rows: MailAddressRow[]) {
  return rows.map((row) => ({ name: row.name, address: row.address }));
}

export async function getThread(threadId: number) {
  const [thread] = await db
    .select({
      id: mailThread.id,
      teamId: mailThread.teamId,
      subject: mailThread.subject,
      projectId: mailThread.projectId,
      projectKey: project.key,
      projectName: project.name,
      suggestedProjectId: mailThread.suggestedProjectId,
      suggestedProjectKey: suggested.key,
      suggestedProjectName: suggested.name,
      accountId: mailAccount.id,
      accountName: mailAccount.name,
      accountAddress: mailAccount.address,
    })
    .from(mailThread)
    .innerJoin(mailAccount, eq(mailAccount.id, mailThread.accountId))
    .leftJoin(project, eq(project.id, mailThread.projectId))
    .leftJoin(suggested, eq(suggested.id, mailThread.suggestedProjectId))
    .where(eq(mailThread.id, threadId));
  if (!thread) throw new HttpError(404, 'Mail thread not found');
  const messages = await db
    .select()
    .from(mailMessage)
    .where(and(eq(mailMessage.threadId, threadId), isNull(mailMessage.deletedAt)))
    .orderBy(asc(mailMessage.sentAt), asc(mailMessage.id));
  const ids = messages.map((message) => message.id);
  const [attachments, folders, issues, drafts] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select()
          .from(mailAttachment)
          .where(inArray(mailAttachment.messageId, ids))
          .orderBy(asc(mailAttachment.id)),
    ids.length === 0
      ? []
      : db
          .select({
            messageId: mailMessageFolder.messageId,
            role: mailFolder.role,
            name: mailFolder.name,
          })
          .from(mailMessageFolder)
          .innerJoin(mailFolder, eq(mailFolder.id, mailMessageFolder.folderId))
          .where(inArray(mailMessageFolder.messageId, ids)),
    threadIssues(threadId),
    db
      .select({
        id: mailDraft.id,
        status: mailDraft.status,
        subject: mailDraft.subject,
        updatedAt: mailDraft.updatedAt,
        createdByName: user.name,
      })
      .from(mailDraft)
      .leftJoin(user, eq(user.id, mailDraft.createdByUserId))
      .where(
        and(
          eq(mailDraft.threadId, threadId),
          inArray(mailDraft.status, ['draft', 'pending_approval', 'failed', 'queued']),
        ),
      )
      .orderBy(desc(mailDraft.updatedAt)),
  ]);
  return {
    ...thread,
    issues,
    drafts: drafts.map((draft) => ({
      ...draft,
      status: draft.status as 'draft' | 'pending_approval' | 'failed' | 'queued',
      updatedAt: iso(draft.updatedAt),
    })),
    messages: messages.map((message) => ({
      id: message.id,
      messageId: message.messageId,
      subject: message.subject,
      fromName: message.fromName,
      fromAddress: message.fromAddress,
      to: addresses(message.toAddresses),
      cc: addresses(message.ccAddresses),
      bcc: addresses(message.bccAddresses),
      replyTo: addresses(message.replyTo),
      sentAt: iso(message.sentAt),
      text: message.textBody,
      html: readableHtml(message),
      hasRemoteImages: message.hasRemoteImages,
      allowRemoteImages: message.allowRemoteImages,
      seen: message.seen,
      flagged: message.flagged,
      folders: folders
        .filter((folder) => folder.messageId === message.id)
        .map((folder) => folder.role ?? folder.name),
      attachments: attachments
        .filter((attachment) => attachment.messageId === message.id)
        .map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          vaultPath: attachment.vaultPath,
        })),
    })),
  };
}

export async function threadIssues(threadId: number) {
  const rows = await db
    .select({
      id: issue.id,
      title: issue.title,
      sequenceNumber: issue.sequenceNumber,
      projectKey: project.key,
    })
    .from(mailThreadIssue)
    .innerJoin(issue, eq(issue.id, mailThreadIssue.issueId))
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(eq(mailThreadIssue.threadId, threadId))
    .orderBy(asc(mailThreadIssue.createdAt));
  return rows.map((row) => ({ ...row, identifier: `${row.projectKey}-${row.sequenceNumber}` }));
}

export type ThreadAction = 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'trash';

// Changes the thread in Plan at once and queues the same change for the worker to
// make on the server. Archive takes the thread out of the inbox; delete moves it to
// the trash, which is only imported when the account says so.
export async function applyThreadAction(threadId: number, action: ThreadAction): Promise<void> {
  await db.transaction(async (tx) => {
    const messages = await tx
      .select({
        id: mailMessage.id,
        accountId: mailMessage.accountId,
        seen: mailMessage.seen,
        flagged: mailMessage.flagged,
      })
      .from(mailMessage)
      .where(and(eq(mailMessage.threadId, threadId), isNull(mailMessage.deletedAt)))
      .orderBy(asc(mailMessage.sentAt), asc(mailMessage.id));
    let changed: number[];
    if (action === 'read' || action === 'unread') {
      changed = messages.filter((message) => message.seen !== (action === 'read')).map((m) => m.id);
      if (changed.length > 0)
        await tx
          .update(mailMessage)
          .set({ seen: action === 'read' })
          .where(inArray(mailMessage.id, changed));
    } else if (action === 'flag') {
      const latest = messages.at(-1);
      changed = latest && !latest.flagged ? [latest.id] : [];
      if (changed.length > 0)
        await tx.update(mailMessage).set({ flagged: true }).where(inArray(mailMessage.id, changed));
    } else if (action === 'unflag') {
      changed = messages.filter((message) => message.flagged).map((message) => message.id);
      if (changed.length > 0)
        await tx
          .update(mailMessage)
          .set({ flagged: false })
          .where(inArray(mailMessage.id, changed));
    } else {
      changed = messages.map((message) => message.id);
    }
    if (changed.length === 0) return;
    if (action === 'trash') {
      await tx
        .update(mailMessage)
        .set({ deletedAt: new Date() })
        .where(inArray(mailMessage.id, changed));
    }
    const locations = await tx
      .select({
        messageId: mailMessageFolder.messageId,
        folderId: mailMessageFolder.folderId,
        uid: mailMessageFolder.uid,
        accountId: mailFolder.accountId,
        role: mailFolder.role,
      })
      .from(mailMessageFolder)
      .innerJoin(mailFolder, eq(mailFolder.id, mailMessageFolder.folderId))
      .where(inArray(mailMessageFolder.messageId, changed));
    const affected =
      action === 'archive' ? locations.filter((location) => location.role === 'inbox') : locations;
    if (affected.length === 0) return;
    const kind =
      { read: 'seen', unread: 'unseen', flag: 'flag', unflag: 'unflag' }[
        action as 'read' | 'unread' | 'flag' | 'unflag'
      ] ?? action;
    await tx.insert(mailAction).values(
      affected.map((location) => ({
        accountId: location.accountId,
        messageId: location.messageId,
        folderId: location.folderId,
        uid: location.uid,
        kind,
      })),
    );
    if (action === 'archive' || action === 'trash') {
      for (const location of affected) {
        await tx
          .delete(mailMessageFolder)
          .where(
            and(
              eq(mailMessageFolder.folderId, location.folderId),
              eq(mailMessageFolder.uid, location.uid),
            ),
          );
      }
    }
  });
}

export async function setRemoteImages(messageId: number, allow: boolean): Promise<void> {
  await db
    .update(mailMessage)
    .set({ allowRemoteImages: allow })
    .where(eq(mailMessage.id, messageId));
}

export async function messageThreadId(messageId: number): Promise<number | null> {
  const [row] = await db
    .select({ threadId: mailMessage.threadId })
    .from(mailMessage)
    .where(eq(mailMessage.id, messageId));
  return row?.threadId ?? null;
}

export async function attachmentThreadId(attachmentId: number): Promise<number | null> {
  const [row] = await db
    .select({ threadId: mailMessage.threadId })
    .from(mailAttachment)
    .innerJoin(mailMessage, eq(mailMessage.id, mailAttachment.messageId))
    .where(eq(mailAttachment.id, attachmentId));
  return row?.threadId ?? null;
}

// An image of the message that its HTML shows by Content-ID. Only images are served.
export async function inlinePart(messageId: number, contentId: string) {
  const [message] = await db
    .select({ rawKey: mailMessage.rawKey })
    .from(mailMessage)
    .where(eq(mailMessage.id, messageId));
  if (!message) throw new HttpError(404, 'Mail message not found');
  let raw: Buffer;
  try {
    const object = await getObject(message.rawKey);
    raw = Buffer.from(await new Response(object.body).arrayBuffer());
  } catch {
    throw new HttpError(404, 'Mail message not found');
  }
  const part = await findInlinePart(raw, contentId);
  if (!part || !part.contentType.startsWith('image/')) throw new HttpError(404, 'Part not found');
  return part;
}

export async function attachmentFile(attachmentId: number) {
  const [row] = await db.select().from(mailAttachment).where(eq(mailAttachment.id, attachmentId));
  if (!row) throw new HttpError(404, 'Attachment not found');
  const file = Bun.file(vaultAbsolute(row.vaultPath));
  if (!(await file.exists())) throw new HttpError(404, 'The attachment is no longer in the vault');
  return { row, file };
}

export async function searchContacts(teamId: number, q: string) {
  const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return db
    .select({ name: mailContact.name, address: mailContact.address })
    .from(mailContact)
    .where(
      and(
        eq(mailContact.teamId, teamId),
        or(ilike(mailContact.address, pattern), ilike(mailContact.name, pattern)),
      ),
    )
    .orderBy(desc(mailContact.messageCount), desc(mailContact.lastSeenAt))
    .limit(8);
}

// The threads linked to a task, for its Mails section.
export async function issueThreads(issueId: number, scope: MailScope) {
  const rows = await db
    .select({
      id: mailThread.id,
      projectId: mailThread.projectId,
      subject: mailThread.subject,
      lastMessageAt: mailThread.lastMessageAt,
      fromName: mailThread.lastFromName,
      fromAddress: mailThread.lastFromAddress,
      snippet: mailThread.snippet,
      accountAddress: mailAccount.address,
    })
    .from(mailThreadIssue)
    .innerJoin(mailThread, eq(mailThread.id, mailThreadIssue.threadId))
    .innerJoin(mailAccount, eq(mailAccount.id, mailThread.accountId))
    .where(and(eq(mailThreadIssue.issueId, issueId), scopeCondition(scope)))
    .orderBy(desc(mailThread.lastMessageAt));
  return rows.map(({ projectId: _projectId, ...row }) => ({
    ...row,
    lastMessageAt: iso(row.lastMessageAt),
  }));
}
