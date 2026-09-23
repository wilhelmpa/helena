import {
  db,
  hubInboxEvent,
  hubInboxSource,
  mailAttachment,
  mailContact,
  mailMessage,
  mailRule,
  mailThread,
} from '@repo/db';
import {
  mailAttachmentFolder,
  matchMailRule,
  parseMessage,
  pickVaultFolder,
  ruleAddresses,
  sha256,
  threadKeyOf,
  writeVaultFile,
  type MailAddress,
  type ParsedMessage,
} from '@repo/mail';
import { putObject } from '@repo/storage';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import {
  addLocation,
  messageIdsOf,
  projectKeyOf,
  type ServerFlags,
  type SyncAccount,
} from './store';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ImportTarget {
  folderId: number | null;
  uid: number | null;
  flags: ServerFlags;
  internalDate?: Date;
  // A message that arrived in the inbox after its first complete import.
  newInboxMail: boolean;
}

// Stores one message and returns its row id. A message already stored for the account
// (same Message-ID) only gains the folder location.
export async function importRawMessage(
  account: Pick<SyncAccount, 'id' | 'teamId' | 'projectId' | 'address' | 'triageEnabled'>,
  raw: Buffer,
  target: ImportTarget,
): Promise<number> {
  const parsed = await parseMessage(raw, target.internalDate ?? new Date());
  const known = (await messageIdsOf(account.id, [parsed.messageId])).get(parsed.messageId);
  const messageRowId = known ?? (await storeMessage(account, parsed, raw, target));
  if (target.folderId != null && target.uid != null) {
    await addLocation(target.folderId, target.uid, messageRowId, target.flags);
  }
  return messageRowId;
}

async function storeMessage(
  account: Pick<SyncAccount, 'id' | 'teamId' | 'projectId' | 'address' | 'triageEnabled'>,
  parsed: ParsedMessage,
  raw: Buffer,
  target: ImportTarget,
): Promise<number> {
  const rawKey = `mail/${account.id}/${sha256(raw)}.eml`;
  await putObject(rawKey, raw, 'message/rfc822');
  const thread = await resolveThread(account, parsed);
  const files = await writeAttachments(await projectKeyOf(thread.projectId), parsed);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(mailMessage)
      .values({
        teamId: account.teamId,
        accountId: account.id,
        threadId: thread.id,
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        subject: parsed.subject,
        fromName: parsed.from?.name ?? '',
        fromAddress: parsed.from?.address ?? '',
        toAddresses: parsed.to,
        ccAddresses: parsed.cc,
        bccAddresses: parsed.bcc,
        replyTo: parsed.replyTo,
        addressText: addressText([parsed.from, ...parsed.to, ...parsed.cc]),
        sentAt: parsed.date,
        snippet: parsed.snippet,
        textBody: parsed.text,
        htmlBody: parsed.html,
        hasRemoteImages: parsed.hasRemoteImages,
        hasAttachments: files.paths.length > 0,
        attachmentFolder: files.folder,
        size: raw.length,
        rawKey,
        ...target.flags,
      })
      .onConflictDoNothing()
      .returning({ id: mailMessage.id });
    if (!row) {
      const [existing] = await tx
        .select({ id: mailMessage.id })
        .from(mailMessage)
        .where(
          and(eq(mailMessage.accountId, account.id), eq(mailMessage.messageId, parsed.messageId)),
        );
      return existing!.id;
    }
    if (files.paths.length > 0) {
      await tx
        .insert(mailAttachment)
        .values(files.paths.map((file) => ({ messageId: row.id, ...file })));
    }
    await tx
      .update(mailThread)
      .set({
        lastMessageAt: parsed.date,
        lastFromName: parsed.from?.name ?? '',
        lastFromAddress: parsed.from?.address ?? '',
        snippet: parsed.snippet,
        updatedAt: new Date(),
      })
      .where(and(eq(mailThread.id, thread.id), lte(mailThread.lastMessageAt, parsed.date)));
    await saveContacts(tx, account, parsed);
    if (target.newInboxMail && account.triageEnabled) {
      await recordTriageEvent(tx, account, thread.id, row.id, parsed);
    }
    return row.id;
  });
}

// The thread of the parent when the parent is stored, else the thread named by the
// root of References. A new thread starts in the project a routing rule names, or in
// the account's project.
async function resolveThread(
  account: Pick<SyncAccount, 'id' | 'teamId' | 'projectId' | 'address'>,
  parsed: ParsedMessage,
): Promise<{ id: number; projectId: number | null }> {
  const columns = { id: mailThread.id, projectId: mailThread.projectId };
  if (parsed.inReplyTo) {
    const [parent] = await db
      .select(columns)
      .from(mailMessage)
      .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
      .where(
        and(eq(mailMessage.accountId, account.id), eq(mailMessage.messageId, parsed.inReplyTo)),
      );
    if (parent) return parent;
  }
  const threadKey = threadKeyOf(parsed);
  const byKey = () =>
    db
      .select(columns)
      .from(mailThread)
      .where(and(eq(mailThread.accountId, account.id), eq(mailThread.threadKey, threadKey)));
  const [existing] = await byKey();
  if (existing) return existing;
  const [created] = await db
    .insert(mailThread)
    .values({
      teamId: account.teamId,
      accountId: account.id,
      projectId: (await routedProject(account, parsed)) ?? account.projectId,
      threadKey,
      subject: parsed.subject,
      lastMessageAt: parsed.date,
      lastFromName: parsed.from?.name ?? '',
      lastFromAddress: parsed.from?.address ?? '',
      snippet: parsed.snippet,
    })
    .onConflictDoNothing()
    .returning(columns);
  return created ?? (await byKey())[0]!;
}

async function routedProject(
  account: Pick<SyncAccount, 'id' | 'teamId' | 'address'>,
  parsed: ParsedMessage,
): Promise<number | null> {
  const rules = await db
    .select()
    .from(mailRule)
    .where(
      and(
        eq(mailRule.teamId, account.teamId),
        or(isNull(mailRule.accountId), eq(mailRule.accountId, account.id)),
      ),
    );
  if (rules.length === 0) return null;
  const addresses = ruleAddresses(account.address, parsed.from, [...parsed.to, ...parsed.cc]);
  const typed = rules.map((rule) => ({
    ...rule,
    matchType: rule.matchType as 'address' | 'domain',
  }));
  return matchMailRule(typed, account.id, addresses)?.projectId ?? null;
}

async function writeAttachments(projectKey: string | null, parsed: ParsedMessage) {
  if (parsed.attachments.length === 0) return { folder: null, paths: [] };
  const folder = await pickVaultFolder(
    mailAttachmentFolder({
      projectKey,
      date: parsed.date,
      senderName: parsed.from?.name || parsed.from?.address || '',
      subject: parsed.subject,
    }),
    async (candidate) => {
      const [row] = await db
        .select({ id: mailMessage.id })
        .from(mailMessage)
        .where(eq(mailMessage.attachmentFolder, candidate))
        .limit(1);
      return Boolean(row);
    },
  );
  const paths = [];
  for (const attachment of parsed.attachments) {
    paths.push({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      sha256: attachment.sha256,
      vaultPath: await writeVaultFile(
        folder,
        attachment.filename,
        attachment.content,
        attachment.sha256,
      ),
    });
  }
  return { folder, paths };
}

// Every address with its local part and domain, so a search for "verve" finds
// "anna@verve.example".
function addressText(addresses: (MailAddress | null)[]): string {
  return addresses
    .flatMap((item) => {
      if (!item) return [];
      const at = item.address.lastIndexOf('@');
      return [item.name, item.address, item.address.slice(0, at), item.address.slice(at + 1)];
    })
    .filter(Boolean)
    .join(' ');
}

async function saveContacts(
  tx: Transaction,
  account: Pick<SyncAccount, 'teamId' | 'address'>,
  parsed: ParsedMessage,
): Promise<void> {
  const own = account.address.toLowerCase();
  const people = new Map<string, string>();
  for (const item of [parsed.from, ...parsed.to, ...parsed.cc]) {
    if (!item?.address || item.address === own) continue;
    if (!people.get(item.address)) people.set(item.address, item.name);
  }
  if (people.size === 0) return;
  await tx
    .insert(mailContact)
    .values(
      [...people].map(([address, name]) => ({
        teamId: account.teamId,
        address,
        name,
        messageCount: 1,
        lastSeenAt: parsed.date,
      })),
    )
    .onConflictDoUpdate({
      target: [mailContact.teamId, mailContact.address],
      set: {
        messageCount: sql`${mailContact.messageCount} + 1`,
        name: sql`CASE WHEN excluded.name <> '' THEN excluded.name ELSE ${mailContact.name} END`,
        lastSeenAt: sql`GREATEST(excluded.last_seen_at, ${mailContact.lastSeenAt})`,
      },
    });
}

// Hands new inbox mail to the inbox triage the way the hub inbox always received it:
// a hub_inbox_event of the account's mail source, which the hub inbox worker turns into
// a thread and sends to the Mastra inbox-triage workflow.
async function recordTriageEvent(
  tx: Transaction,
  account: Pick<SyncAccount, 'teamId' | 'address'>,
  threadId: number,
  messageRowId: number,
  parsed: ParsedMessage,
): Promise<void> {
  const [source] = await tx
    .insert(hubInboxSource)
    .values({
      teamId: account.teamId,
      channel: 'mail',
      account: account.address,
      status: 'connected',
    })
    .onConflictDoUpdate({
      target: [hubInboxSource.teamId, hubInboxSource.channel, hubInboxSource.account],
      set: { status: 'connected', lastSyncAt: new Date(), updatedAt: new Date() },
    })
    .returning({ id: hubInboxSource.id, enabled: hubInboxSource.enabled });
  if (!source?.enabled) return;
  const sender = parsed.from
    ? parsed.from.name
      ? `${parsed.from.name} <${parsed.from.address}>`
      : parsed.from.address
    : '';
  await tx
    .insert(hubInboxEvent)
    .values({
      sourceId: source.id,
      teamId: account.teamId,
      externalEventId: `mail:${messageRowId}`,
      externalThreadId: `mail-thread:${threadId}`,
      externalMessageId: parsed.messageId.slice(0, 512),
      sender: sender.slice(0, 500),
      subject: parsed.subject.slice(0, 500),
      snippet: parsed.snippet,
      receivedAt: parsed.date,
    })
    .onConflictDoNothing();
}
