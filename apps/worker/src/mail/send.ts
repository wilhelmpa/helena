import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { db, mailDraft, mailFolder, mailMessage, type MailAddressRow } from '@repo/db';
import {
  buildMime,
  connectionError,
  isGmailHost,
  vaultAbsolute,
  type MailServerSettings,
} from '@repo/mail';
import { deleteObject, getObject } from '@repo/storage';
import { and, eq, lt, sql } from 'drizzle-orm';
import { importRawMessage } from './import';
import { accountSettings, accountWithCredential } from './store';
import { mailTransport } from './transport';

const STALE_SENDING_MS = 10 * 60_000;

// A draft an agent asked to send goes out once the owner approved the request, and
// returns to the drafts when the owner rejected it.
export async function applyApprovalDecisions(): Promise<void> {
  await db.execute(sql`
    UPDATE mail_draft d
       SET status = 'queued', send_at = now(), updated_at = now()
      FROM approval_request a
     WHERE a.id = d.approval_request_id
       AND d.status = 'pending_approval'
       AND a.status = 'approved'
  `);
  await db.execute(sql`
    UPDATE mail_draft d
       SET status = 'draft', last_error = 'The owner rejected sending this mail.', updated_at = now()
      FROM approval_request a
     WHERE a.id = d.approval_request_id
       AND d.status = 'pending_approval'
       AND a.status = 'rejected'
  `);
}

// Sends the drafts whose undo time is over. A draft is sent at most once: one whose
// send was interrupted is marked failed rather than sent again, because the server may
// have accepted it.
export async function sendDueDrafts(): Promise<number> {
  await db
    .update(mailDraft)
    .set({
      status: 'failed',
      lastError: 'Sending was interrupted. Check the Sent folder before sending again.',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailDraft.status, 'sending'),
        lt(mailDraft.updatedAt, new Date(Date.now() - STALE_SENDING_MS)),
      ),
    );
  const claimed = (await db.execute(sql`
    UPDATE mail_draft
       SET status = 'sending', attempts = attempts + 1, updated_at = now()
     WHERE id IN (
       SELECT id FROM mail_draft
        WHERE status = 'queued' AND send_at <= now()
        ORDER BY send_at
        FOR UPDATE SKIP LOCKED
        LIMIT 5
     )
    RETURNING id
  `)) as unknown as { id: number }[];
  for (const row of claimed) await sendDraft(row.id);
  return claimed.length;
}

async function fail(draftId: number, error: string): Promise<void> {
  await db
    .update(mailDraft)
    .set({ status: 'failed', lastError: error.slice(0, 500), updatedAt: new Date() })
    .where(eq(mailDraft.id, draftId));
}

async function attachmentContent(source: 'storage' | 'vault', ref: string): Promise<Buffer> {
  if (source === 'vault') return readFile(vaultAbsolute(ref));
  const object = await getObject(ref);
  return Buffer.from(await new Response(object.body).arrayBuffer());
}

function addresses(rows: MailAddressRow[]) {
  return rows.map((row) => ({ name: row.name, address: row.address }));
}

async function sendDraft(draftId: number): Promise<void> {
  const [draft] = await db.select().from(mailDraft).where(eq(mailDraft.id, draftId));
  if (!draft) return;
  const found = await accountWithCredential(draft.accountId);
  let settings: MailServerSettings;
  try {
    if (!found) throw new Error('No password');
    settings = accountSettings(found.account, found.credential);
  } catch {
    await fail(draftId, 'The account has no password.');
    return;
  }
  const { account } = found;
  const [parent] = draft.replyToMessageId
    ? await db.select().from(mailMessage).where(eq(mailMessage.id, draft.replyToMessageId))
    : [];
  let files;
  try {
    files = await Promise.all(
      draft.attachments.map(async (file) => ({
        filename: file.filename,
        contentType: file.contentType,
        content: await attachmentContent(file.source, file.ref),
      })),
    );
  } catch {
    await fail(draftId, 'An attachment could not be read.');
    return;
  }
  const domain = account.address.slice(account.address.lastIndexOf('@') + 1);
  const mail = {
    messageId: `<${randomUUID()}@${domain}>`,
    date: new Date(),
    from: { name: account.name, address: account.address },
    to: addresses(draft.toAddresses),
    cc: addresses(draft.ccAddresses),
    bcc: addresses(draft.bccAddresses),
    subject: draft.subject,
    html: draft.bodyHtml,
    text: draft.bodyText,
    inReplyTo: parent?.messageId ?? null,
    references: parent ? [...parent.references, parent.messageId] : [],
    attachments: files,
  };
  const recipients = [...mail.to, ...mail.cc, ...mail.bcc].map((item) => item.address);
  try {
    await mailTransport().send(
      settings,
      { from: account.address, to: recipients },
      await buildMime(mail, false),
    );
  } catch (error) {
    await fail(draftId, connectionError(error));
    return;
  }
  await db
    .update(mailDraft)
    .set({ status: 'sent', sentMessageId: mail.messageId, lastError: null, updatedAt: new Date() })
    .where(eq(mailDraft.id, draftId));
  const copy = await buildMime(mail, true);
  let sentCopy: { folderId: number; uid: number } | null = null;
  // Gmail files what its SMTP server sends in Sent Mail by itself.
  if (!isGmailHost(settings.imapHost)) {
    try {
      sentCopy = await appendToSent(account.id, settings, copy);
    } catch (error) {
      console.error(`[mail] draft ${draftId}: the Sent copy failed: ${connectionError(error)}`);
      await db
        .update(mailDraft)
        .set({ lastError: 'Sent, but the copy for the Sent folder could not be saved.' })
        .where(eq(mailDraft.id, draftId));
    }
  }
  await importRawMessage(account, copy, {
    folderId: sentCopy?.folderId ?? null,
    uid: sentCopy?.uid ?? null,
    flags: { seen: true, flagged: false, answered: false },
    newInboxMail: false,
  });
  if (parent)
    await db.update(mailMessage).set({ answered: true }).where(eq(mailMessage.id, parent.id));
  for (const file of draft.attachments) {
    if (file.source === 'storage') await deleteObject(file.ref).catch(() => undefined);
  }
}

async function appendToSent(
  accountId: number,
  settings: MailServerSettings,
  raw: Buffer,
): Promise<{ folderId: number; uid: number } | null> {
  const [sent] = await db
    .select({ id: mailFolder.id, path: mailFolder.path })
    .from(mailFolder)
    .where(and(eq(mailFolder.accountId, accountId), eq(mailFolder.role, 'sent')));
  if (!sent) return null;
  const client = mailTransport().imap(settings);
  client.on('error', () => undefined);
  try {
    await client.connect();
    const result = await client.append(sent.path, raw, ['\\Seen']);
    await client.logout();
    return result && result.uid ? { folderId: sent.id, uid: result.uid } : null;
  } finally {
    client.close();
  }
}
