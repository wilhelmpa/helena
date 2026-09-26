import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { db, project, mailAttachment, mailMessage } from '@repo/db';
import { parseMessage, sha256 } from '@repo/mail';
import { getObject } from '@repo/storage';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { importRawMessage } from '../../../worker/src/mail/import';
import {
  connectSettings,
  flagsOf,
  loadSyncAccounts,
  type SyncAccount,
} from '../../../worker/src/mail/store';
import { mailTransport, type ImapClient } from '../../../worker/src/mail/transport';
import {
  hasMailReceiptEvidence,
  mailReceiptFacts,
  receiptFilename,
  unrelatedFilename,
} from '#modules/receipts/mail-facts';
import { intakeMailReceipts, MAX_RECEIPT_BYTES } from '#modules/receipts/receipts';

import {
  assertHistoryMailbox,
  fetchReceiptHistorySource,
  HistoryError,
} from './mail-receipt-source';
export { HistoryError } from './mail-receipt-source';

const TERMS = [
  'invoice',
  'receipt',
  'rechnung',
  'beleg',
  'quittung',
  'gutschrift',
  'refund',
  'zahlung',
  'payment',
  'mahnung',
  'order',
  'purchase',
  'sent you money',
  'bill',
  'statement',
  'abrechnung',
];

export const MAX_BATCH_BYTES = 100 * 1024 * 1024;

const Candidate = z.object({
  uid: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  subject: z.string(),
  attachmentSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  includeBody: z.boolean(),
  selected: z.boolean(),
  attachments: z.array(z.object({ filename: z.string(), sha256: z.string(), size: z.number() })),
});
const Manifest = z.object({
  accountId: z.number().int().positive(),
  projectKey: z.string(),
  folder: z.string(),
  uidValidity: z.string(),
  since: z.string(),
  before: z.string(),
  nextBeforeUid: z.number().int().nullable(),
  remaining: z.number().int(),
  earlierCandidates: z.number().int(),
  oversizedUids: z.array(z.number().int()),
  candidates: z.array(Candidate).max(50),
});
type HistoryManifest = z.infer<typeof Manifest>;

async function assertProject(account: SyncAccount, projectKey: string) {
  const [target] = await db
    .select({ id: project.id, teamId: project.teamId })
    .from(project)
    .where(eq(project.key, projectKey));
  if (!target || target.id !== account.projectId || target.teamId !== account.teamId)
    throw new HistoryError('Mailbox project scope does not match.');
  return target;
}

export async function checkedReceiptHistoryManifest(account: SyncAccount, value: unknown) {
  const manifest = Manifest.parse(value);
  const uids = manifest.candidates.map((candidate) => candidate.uid);
  if (new Set(uids).size !== uids.length)
    throw new HistoryError('The inspected manifest contains duplicate UIDs.');
  if (manifest.accountId !== account.id)
    throw new HistoryError('Mailbox does not match the reviewed manifest.');
  const target = await assertProject(account, manifest.projectKey);
  return { manifest, target };
}

async function assertStoredOriginal(messageId: number, expectedSha: string, uid: number) {
  const [message] = await db
    .select({ rawKey: mailMessage.rawKey, size: mailMessage.size })
    .from(mailMessage)
    .where(eq(mailMessage.id, messageId));
  if (!message || message.size > MAX_RECEIPT_BYTES)
    throw new HistoryError(`Stored original unavailable or too large for UID ${uid}.`);
  const stored = await getObject(message.rawKey);
  const reader = stored.body.getReader();
  const hash = createHash('sha256');
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RECEIPT_BYTES)
        throw new HistoryError(`Stored original exceeds limits for UID ${uid}.`);
      hash.update(value);
    }
  } finally {
    await reader.cancel();
  }
  if (hash.digest('hex') !== expectedSha)
    throw new HistoryError(`Stored original does not match the reviewed original for UID ${uid}.`);
}

export function internalDateOf(value: Date | string | undefined): Date {
  const date = value === undefined ? new Date(NaN) : new Date(value);
  if (!Number.isFinite(+date)) throw new HistoryError('Provider internal date is unavailable.');
  return date;
}

/** A bounded provider read: no mail locations, events, classifier or retention settings change. */
export async function inspectReceiptHistory(
  client: ImapClient,
  account: SyncAccount,
  input: {
    projectKey: string;
    folder: string;
    since: string;
    before: string;
    beforeUid?: number;
    limit?: number;
  },
): Promise<HistoryManifest> {
  await assertProject(account, input.projectKey);
  const since = new Date(input.since);
  const before = new Date(input.before);
  const limit = input.limit ?? 20;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.since) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.before) ||
    !Number.isFinite(+since) ||
    !Number.isFinite(+before) ||
    since.toISOString().slice(0, 10) !== input.since ||
    before.toISOString().slice(0, 10) !== input.before ||
    since >= before ||
    +before - +since > 366 * 86_400_000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (input.beforeUid !== undefined &&
      (!Number.isSafeInteger(input.beforeUid) || input.beforeUid < 1))
  )
    throw new HistoryError('Use a valid date window of at most 366 days and a limit of 1–50.');
  const lock = await client.getMailboxLock(input.folder, { readOnly: true });
  try {
    if (!client.mailbox) throw new HistoryError('Mailbox was not opened.');
    const uidValidity = String(client.mailbox.uidValidity);
    assertHistoryMailbox(client, { folder: input.folder, uidValidity });
    const criteria = [
      ...TERMS.map((subject) => ({ subject })),
      ...['amount paid', 'total charge', 'transaktionscode', 'rechnungsnummer'].map((body) => ({
        body,
      })),
    ];
    const result = await client.search({ since, before, or: criteria }, { uid: true });
    const earlier = await client.search({ before: since, or: criteria }, { uid: true });
    assertHistoryMailbox(client, { folder: input.folder, uidValidity });
    const uids = (Array.isArray(result) ? result : [])
      .filter((uid) => input.beforeUid === undefined || uid < input.beforeUid)
      .sort((a, b) => b - a);
    const chosen = uids.slice(0, limit);
    const candidates: HistoryManifest['candidates'] = [];
    const oversizedUids: number[] = [];
    let bytes = 0;
    for (const uid of chosen) {
      const source = await fetchReceiptHistorySource(
        client,
        { folder: input.folder, uidValidity },
        uid,
        MAX_BATCH_BYTES - bytes,
        MAX_RECEIPT_BYTES,
      );
      if (!source) {
        oversizedUids.push(uid);
        continue;
      }
      bytes += source.source.length;
      const mail = await parseMessage(source.source, internalDateOf(source.internalDate));
      const facts = mailReceiptFacts({
        subject: mail.subject,
        textBody: mail.text,
        fromName: mail.from?.name ?? '',
        fromAddress: mail.from?.address ?? '',
        sentAt: mail.date,
      });
      const attachments = mail.attachments.map((a) => ({
        filename: a.filename,
        sha256: a.sha256,
        size: a.size,
      }));
      const attachmentSha256 = attachments
        .filter(
          (a) =>
            /\.(pdf|xml|png|jpe?g)$/i.test(a.filename) &&
            receiptFilename(a.filename) &&
            !unrelatedFilename(a.filename),
        )
        .map((a) => a.sha256);
      const includeBody =
        attachmentSha256.length === 0 &&
        !/^(?:re|aw|fwd?):/i.test(mail.subject) &&
        (hasMailReceiptEvidence(mail.subject, facts) ||
          (facts.grossCents !== null && facts.invoiceNumber !== null));
      candidates.push({
        uid,
        sha256: sha256(source.source),
        subject: mail.subject.slice(0, 300),
        attachments,
        attachmentSha256,
        includeBody,
        selected: attachmentSha256.length > 0 || includeBody,
      });
    }
    return {
      accountId: account.id,
      projectKey: input.projectKey,
      folder: input.folder,
      uidValidity,
      since: input.since,
      before: input.before,
      nextBeforeUid: chosen.at(-1) ?? null,
      remaining: Math.max(0, uids.length - chosen.length),
      earlierCandidates: Array.isArray(earlier) ? earlier.length : 0,
      oversizedUids,
      candidates,
    };
  } finally {
    lock.release();
  }
}

export async function applyReceiptHistory(
  client: ImapClient,
  account: SyncAccount,
  value: unknown,
) {
  const { manifest, target } = await checkedReceiptHistoryManifest(account, value);
  if (
    manifest.candidates.some((c) => c.selected && !c.includeBody && c.attachmentSha256.length === 0)
  )
    throw new HistoryError('A selected candidate must name an original body or attachment.');
  const lock = await client.getMailboxLock(manifest.folder, { readOnly: true });
  const reports = [];
  try {
    assertHistoryMailbox(client, manifest);
    let bytes = 0;
    for (const candidate of manifest.candidates.filter((item) => item.selected)) {
      const source = await fetchReceiptHistorySource(
        client,
        manifest,
        candidate.uid,
        MAX_BATCH_BYTES - bytes,
        MAX_RECEIPT_BYTES,
      );
      if (!source)
        throw new HistoryError(`Original unavailable or exceeds limits for UID ${candidate.uid}.`);
      if (sha256(source.source) !== candidate.sha256)
        throw new HistoryError(`Original changed for UID ${candidate.uid}.`);
      bytes += source.source.length;
      const internalDate = internalDateOf(source.internalDate);
      const parsed = await parseMessage(source.source, internalDate);
      if (
        candidate.attachmentSha256.some(
          (hash) => !parsed.attachments.some((a) => a.sha256 === hash),
        )
      )
        throw new HistoryError(`Selected attachment is not in UID ${candidate.uid}.`);
      const messageId = await importRawMessage(
        { ...account, triageEnabled: false },
        source.source,
        {
          folderId: null,
          uid: null,
          flags: flagsOf(source.flags),
          internalDate,
          newInboxMail: false,
          requiredProjectId: target.id,
        },
      );
      // Message-ID deduplication may reuse a different original, including a concurrent import.
      await assertStoredOriginal(messageId, candidate.sha256, candidate.uid);
      const attachments = await db
        .select({ id: mailAttachment.id, sha256: mailAttachment.sha256 })
        .from(mailAttachment)
        .where(eq(mailAttachment.messageId, messageId));
      if (candidate.attachmentSha256.some((hash) => !attachments.some((a) => a.sha256 === hash)))
        throw new HistoryError(`Selected stored attachment is missing for UID ${candidate.uid}.`);
      const receiptIds = await intakeMailReceipts({
        teamId: target.teamId,
        projectId: target.id,
        messageId,
        actorUserId: null,
        attachmentIds: attachments
          .filter((a) => candidate.attachmentSha256.includes(a.sha256))
          .map((a) => a.id),
        includeBody: candidate.includeBody,
      });
      if (!receiptIds.length)
        throw new HistoryError(
          `No selected receipt could be filed for UID ${candidate.uid}; message ${messageId}.`,
        );
      reports.push({ uid: candidate.uid, messageId, receiptIds });
    }
  } finally {
    lock.release();
  }
  return {
    accountId: account.id,
    projectKey: manifest.projectKey,
    processed: reports.length,
    reports,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const accountId = Number(value('account'));
  const projectKey = value('project');
  const apply = value('apply');
  if (!Number.isSafeInteger(accountId) || accountId < 1 || !projectKey)
    throw new HistoryError(
      'Required: --account=<id> --project=<key>; inspect with --folder --since --before --output, or apply with --apply=<reviewed.json>.',
    );
  const [account] = await loadSyncAccounts(accountId);
  if (!account) throw new HistoryError('Mailbox is not enabled and connected.');
  await assertProject(account, projectKey);
  const client = mailTransport().imap(await connectSettings(account));
  await client.connect();
  try {
    if (apply) {
      const manifest = await Bun.file(apply).json();
      if (manifest.projectKey !== projectKey)
        throw new HistoryError('Manifest project does not match.');
      console.log(JSON.stringify(await applyReceiptHistory(client, account, manifest), null, 2));
    } else {
      const folder = value('folder');
      const since = value('since');
      const before = value('before');
      const output = value('output');
      if (!folder || !since || !before || !output)
        throw new HistoryError('Inspection requires --folder, --since, --before and --output.');
      const manifest = await inspectReceiptHistory(client, account, {
        projectKey,
        folder,
        since,
        before,
        limit: value('limit') ? Number(value('limit')) : undefined,
        beforeUid: value('before-uid') ? Number(value('before-uid')) : undefined,
      });
      await writeFile(output, JSON.stringify(manifest, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      console.log(
        JSON.stringify({
          accountId,
          candidates: manifest.candidates.length,
          selected: manifest.candidates.filter((c) => c.selected).length,
          oversizedUids: manifest.oversizedUids,
          remaining: manifest.remaining,
          earlierCandidates: manifest.earlierCandidates,
          nextBeforeUid: manifest.nextBeforeUid,
          output,
        }),
      );
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

if (import.meta.main) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(
      error instanceof HistoryError
        ? error.message
        : `Mail receipt history failed (${error instanceof Error ? error.name : 'unknown error'}). Original mail and credentials were omitted.`,
    );
    process.exit(1);
  }
}
