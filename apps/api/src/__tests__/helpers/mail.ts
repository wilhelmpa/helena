import {
  db,
  integrationCredential,
  mailAccount,
  mailAttachment,
  mailFolder,
  mailMessage,
  mailMessageFolder,
  mailThread,
  nextCredentialId,
  sealCredential,
} from '@repo/db';
import { mailAttachmentFolder, sha256, writeVaultFile } from '@repo/mail';
import { putObject } from '@repo/storage';
import { eq } from 'drizzle-orm';

// Mail arrives through the worker's IMAP import, which has no route. These helpers
// write the rows the importer writes, so the routes that read and file mail have
// something to act on.

export async function insertMailAccount(
  teamId: number,
  projectId: number | null,
  address = 'me@home.example',
): Promise<{ accountId: number; inboxId: number; sentId: number }> {
  const id = await nextCredentialId();
  const secret = sealCredential(id, JSON.stringify({ value: 'app-password' }));
  const [credential] = await db
    .insert(integrationCredential)
    .values({
      id,
      teamId,
      projectId,
      integrationKey: 'secret',
      label: `Mail: ${address}`,
      ...secret,
    })
    .returning();
  const [account] = await db
    .insert(mailAccount)
    .values({
      teamId,
      projectId,
      name: 'Me',
      address,
      imapHost: '203.0.113.10',
      smtpHost: '203.0.113.10',
      username: address,
      credentialId: credential!.id,
    })
    .returning();
  const [inbox] = await db
    .insert(mailFolder)
    .values({ accountId: account!.id, path: 'INBOX', name: 'INBOX', role: 'inbox' })
    .returning();
  const [sent] = await db
    .insert(mailFolder)
    .values({ accountId: account!.id, path: 'Sent', name: 'Sent', role: 'sent' })
    .returning();
  return { accountId: account!.id, inboxId: inbox!.id, sentId: sent!.id };
}

let uid = 1;

export interface MessageInput {
  teamId: number;
  accountId: number;
  folderId: number;
  projectId?: number | null;
  projectKey?: string | null;
  threadId?: number;
  messageId?: string;
  fromName?: string;
  fromAddress?: string;
  to?: { name: string; address: string }[];
  cc?: { name: string; address: string }[];
  subject?: string;
  text?: string;
  html?: string | null;
  sentAt?: Date;
  seen?: boolean;
  raw?: string;
  attachments?: { filename: string; content: string }[];
}

export async function insertMessage(input: MessageInput) {
  const sentAt = input.sentAt ?? new Date('2026-03-10T12:00:00Z');
  const messageId = input.messageId ?? `<${crypto.randomUUID()}@verve.example>`;
  const subject = input.subject ?? 'Offer';
  const fromName = input.fromName ?? 'Anna';
  const fromAddress = input.fromAddress ?? 'anna@verve.example';
  let threadId = input.threadId;
  if (threadId === undefined) {
    const [thread] = await db
      .insert(mailThread)
      .values({
        teamId: input.teamId,
        accountId: input.accountId,
        projectId: input.projectId ?? null,
        threadKey: messageId,
        subject,
        lastMessageAt: sentAt,
        lastFromName: fromName,
        lastFromAddress: fromAddress,
        snippet: (input.text ?? 'Hello').slice(0, 200),
      })
      .returning();
    threadId = thread!.id;
  } else {
    await db
      .update(mailThread)
      .set({ lastMessageAt: sentAt, lastFromName: fromName, lastFromAddress: fromAddress })
      .where(eq(mailThread.id, threadId));
  }
  const raw =
    input.raw ??
    `Message-ID: ${messageId}\r\nSubject: ${subject}\r\n\r\n${input.text ?? 'Hello'}\r\n`;
  const rawKey = `mail/${input.accountId}/${sha256(raw)}.eml`;
  await putObject(rawKey, Buffer.from(raw), 'message/rfc822');
  const folder = input.attachments?.length
    ? mailAttachmentFolder({
        projectKey: input.projectKey ?? null,
        date: sentAt,
        senderName: fromName,
        subject,
      })
    : null;
  const [message] = await db
    .insert(mailMessage)
    .values({
      teamId: input.teamId,
      accountId: input.accountId,
      threadId,
      messageId,
      subject,
      fromName,
      fromAddress,
      toAddresses: input.to ?? [{ name: 'Me', address: 'me@home.example' }],
      ccAddresses: input.cc ?? [],
      addressText: `${fromName} ${fromAddress} ${fromAddress.replace('@', ' ')}`,
      sentAt,
      snippet: (input.text ?? 'Hello').slice(0, 200),
      textBody: input.text ?? 'Hello',
      htmlBody: input.html ?? null,
      hasAttachments: Boolean(input.attachments?.length),
      attachmentFolder: folder,
      size: raw.length,
      rawKey,
      seen: input.seen ?? false,
    })
    .returning();
  await db
    .insert(mailMessageFolder)
    .values({ folderId: input.folderId, uid: uid++, messageId: message!.id });
  for (const file of input.attachments ?? []) {
    const content = Buffer.from(file.content);
    const vaultPath = await writeVaultFile(folder!, file.filename, content, sha256(content));
    await db.insert(mailAttachment).values({
      messageId: message!.id,
      filename: file.filename,
      contentType: 'application/pdf',
      size: content.length,
      sha256: sha256(content),
      vaultPath,
    });
  }
  return { threadId, messageRowId: message!.id, messageId };
}
