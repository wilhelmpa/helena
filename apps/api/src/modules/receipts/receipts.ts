import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  db,
  helenaBankAccount,
  helenaBankTransaction,
  helenaReceipt,
  helenaReceiptMatch,
  helenaReceiptPairHistory,
  mailAttachment,
  mailMessage,
  mailThread,
  project as projectTable,
} from '@repo/db';
import { getObject } from '@repo/storage';
import { absoluteVaultPath, indexVaultPaths } from '@repo/vault';
import { and, count, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import type { AuthUser } from '#shared/access';
import { joinPath, relativePath, safeFileName } from '#modules/project-files/paths';
import { projectRoot, projectVaultPath } from '#modules/project-files/roots';
import { contentTypeOf } from '#modules/project-files/serve';
import { describeVaultFile, writeUniqueFile } from '#modules/project-files/service';
import { centsToNumeric, monthRange } from './amounts';
import { extractReceiptFile, isReceiptFile, type ExtractedReceipt } from './extract';
import {
  hasMailReceiptEvidence,
  mailReceiptFacts,
  receiptFilename,
  unrelatedFilename,
} from './mail-facts';
import { matchReceipt, unlinkReceipt } from './matching';
import { assertReviewedMailSource, type ReviewedMailSource } from './mail-review';
import {
  economicReceipt,
  assertUngroupedReceipt,
  linkReceiptOriginalInTransaction,
  lockReceiptProject,
} from './originals';
import { mailOriginalPair } from './original-pair';
import { autoMergeEnabled, inspectNewReceipts } from './dedup';
import { rebuildReceiptProjection } from './projection';
import { receiptSourceLinks } from './source';
import {
  inMonth,
  receiptDetailView,
  receiptViews,
  type ReceiptDetailView,
  type ReceiptRow,
  type ReceiptView,
} from './views';

// The receipts of a project (docs/helena-decisions/decisions.md §7): uploaded in Helena (stored
// in the vault under Files/Belege/<month>), taken from a file already in the project's vault,
// or from an invoice mail's attachments. A receipt from the vault or a mail keeps pointing at
// its file; nothing is copied. Each receipt is read on arrival and matched right away.

export const MAX_RECEIPT_BYTES = 25 * 1024 * 1024;
// Images in a mail are receipts only when the mail has no PDF or XML and they are big enough
// not to be a logo in the signature.
const MIN_MAIL_IMAGE_BYTES = 30 * 1024;

export class DuplicateReceipt extends HttpError {
  constructor(public existingId: number) {
    super(409, 'This receipt is already here.', 'duplicate');
  }
}

type Project = { id: number; teamId: number; key: string };
type ReceiptDb = Pick<typeof db, 'select' | 'insert'>;

export async function ownIbans(projectId: number, executor: ReceiptDb = db): Promise<string[]> {
  const rows = await executor
    .select({ iban: helenaBankAccount.iban })
    .from(helenaBankAccount)
    .where(and(eq(helenaBankAccount.projectId, projectId), isNotNull(helenaBankAccount.iban)));
  return rows.map((row) => row.iban!).filter(Boolean);
}

export async function requireReceipt(projectId: number, receiptId: number): Promise<ReceiptRow> {
  const [row] = await db
    .select()
    .from(helenaReceipt)
    .where(and(eq(helenaReceipt.id, receiptId), eq(helenaReceipt.projectId, projectId)));
  if (!row) throw new HttpError(404, 'Receipt not found');
  return row;
}

async function existingBySha(
  projectId: number,
  sha256: string,
  executor: ReceiptDb = db,
): Promise<number | null> {
  const [row] = await executor
    .select({ id: helenaReceipt.id })
    .from(helenaReceipt)
    .where(and(eq(helenaReceipt.projectId, projectId), eq(helenaReceipt.sha256, sha256)));
  return row?.id ?? null;
}

function extractedColumns(facts: ExtractedReceipt) {
  return {
    issuer: facts.issuer?.slice(0, 300) ?? null,
    invoiceNumber: facts.invoiceNumber?.slice(0, 100) ?? null,
    invoiceDate: facts.invoiceDate,
    dueDate: facts.dueDate,
    totalGross: facts.grossCents === null ? null : centsToNumeric(facts.grossCents),
    vatAmount: facts.vatCents === null ? null : centsToNumeric(facts.vatCents),
    currency: facts.currency ?? 'EUR',
    iban: facts.iban,
    direction: facts.direction,
    extraction: facts.extraction,
    extractionError: facts.extractionError,
    textExcerpt: facts.textExcerpt,
    details: facts.details as unknown as Record<string, unknown>,
  };
}

async function viewOf(receiptId: number): Promise<ReceiptDetailView> {
  const [row] = await db.select().from(helenaReceipt).where(eq(helenaReceipt.id, receiptId));
  if (!row) throw new HttpError(404, 'Receipt not found');
  return receiptDetailView(row);
}

// Matching never fails a receipt's arrival: a problem there leaves the receipt open.
async function matchQuietly(receiptId: number): Promise<void> {
  await matchReceipt(receiptId).catch((error: unknown) =>
    console.error(`[receipts] receipt ${receiptId} not matched`, error),
  );
}

function assertReceiptFile(filename: string) {
  if (!isReceiptFile(filename))
    throw new HttpError(400, 'A receipt must be a PDF, PNG, JPG or XML (e-invoice) file.');
}

/** A receipt uploaded in Helena: read it, then store it under Files/Belege/<month>. */
export async function uploadReceipt(
  project: Project,
  file: File,
  userId: string,
  options: {
    source?: string;
    fileDate?: string | null;
    actorRef?: string;
    runId?: number | null;
  } = {},
): Promise<ReceiptDetailView> {
  assertReceiptFile(file.name);
  if (file.size > MAX_RECEIPT_BYTES) throw new HttpError(413, 'A receipt may have at most 25 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const existing = await existingBySha(project.id, sha256);
  if (existing) throw new DuplicateReceipt(existing);

  const name = safeFileName(file.name, 'Beleg');
  const dir = await mkdtemp(path.join(tmpdir(), 'helena-receipt-'));
  let facts: ExtractedReceipt;
  try {
    const temporary = path.join(dir, name);
    await writeFile(temporary, bytes);
    facts = await extractReceiptFile(temporary, name, await ownIbans(project.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const month = (facts.invoiceDate ?? options.fileDate ?? new Date().toISOString()).slice(0, 7);
  const root = projectRoot(project.key);
  const relative = await writeUniqueFile(root, `Files/Belege/${month}`, name, bytes, {
    ref: options.actorRef ?? `user:${userId}`,
    runId: options.runId ?? null,
  });
  const enabled = await autoMergeEnabled(project.teamId);
  const id = await db.transaction(async (tx) => {
    await lockReceiptProject(tx, project.id);
    const [row] = await tx
      .insert(helenaReceipt)
      .values({
        teamId: project.teamId,
        projectId: project.id,
        source: 'upload',
        vaultPath: joinPath(root.vaultPath ?? projectVaultPath(project.key), relative),
        filename: path.basename(relative),
        contentType: contentTypeOf(name),
        size: bytes.length,
        sha256,
        createdByUserId: userId,
        ...extractedColumns(facts),
        ...(options.source ? { details: { ...facts.details, driveSource: options.source } } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: helenaReceipt.id });
    if (!row) throw new DuplicateReceipt((await existingBySha(project.id, sha256, tx))!);
    await inspectNewReceipts(tx, project.id, [row.id], enabled, userId);
    return row.id;
  });
  await matchQuietly(id);
  return viewOf(id);
}

// The project-relative path of a file in the project's vault folder; a full vault path
// ("Projects/KEY/…") is accepted as well.
function projectRelative(projectKey: string, value: string): string {
  const prefix = `${projectVaultPath(projectKey)}/`;
  return relativePath(value.startsWith(prefix) ? value.slice(prefix.length) : value);
}

/** A file that is already in the project's vault becomes a receipt where it is. */
export async function receiptFromVault(
  project: Project,
  filePath: string,
  userId: string,
): Promise<ReceiptDetailView> {
  const relative = projectRelative(project.key, filePath);
  assertReceiptFile(relative);
  const file = await describeVaultFile(projectRoot(project.key), relative);
  if (file.sizeBytes > MAX_RECEIPT_BYTES)
    throw new HttpError(413, 'A receipt may have at most 25 MB.');
  const existing = await existingBySha(project.id, file.sha256);
  if (existing) throw new DuplicateReceipt(existing);
  const facts = await extractReceiptFile(
    absoluteVaultPath(file.vaultPath),
    file.name,
    await ownIbans(project.id),
  );
  const enabled = await autoMergeEnabled(project.teamId);
  const id = await db.transaction(async (tx) => {
    await lockReceiptProject(tx, project.id);
    const [row] = await tx
      .insert(helenaReceipt)
      .values({
        teamId: project.teamId,
        projectId: project.id,
        source: 'vault',
        vaultPath: file.vaultPath,
        filename: file.name,
        contentType: file.contentType,
        size: file.sizeBytes,
        sha256: file.sha256,
        createdByUserId: userId,
        ...extractedColumns(facts),
      })
      .onConflictDoNothing()
      .returning({ id: helenaReceipt.id });
    if (!row) throw new DuplicateReceipt((await existingBySha(project.id, file.sha256, tx))!);
    await inspectNewReceipts(tx, project.id, [row.id], enabled, userId);
    return row.id;
  });
  await matchQuietly(id);
  return viewOf(id);
}

export interface MailReceiptInput {
  teamId: number;
  projectId: number;
  messageId: number;
  actorUserId: string | null;
  attachmentIds?: number[];
  includeBody?: boolean;
  reviewedSource?: ReviewedMailSource;
  skipMatching?: boolean;
}

export interface MailReceiptPlan {
  attachmentId: number | null;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  vaultPath: string | null;
  bytes?: Uint8Array;
  facts: ExtractedReceipt;
  existingId: number | null;
}

async function verifiedExistingMailReceipt(
  target: Project,
  sha256: string,
  executor: ReceiptDb = db,
): Promise<{ id: number; vaultPath: string } | null> {
  const [receipt] = await executor
    .select()
    .from(helenaReceipt)
    .where(and(eq(helenaReceipt.projectId, target.id), eq(helenaReceipt.sha256, sha256)));
  if (!receipt) return null;
  if (!receipt.vaultPath.startsWith(`${projectVaultPath(target.key)}/`))
    throw new HttpError(409, 'The existing receipt original is outside this project.');
  const file = await describeVaultFile(
    projectRoot(target.key),
    projectRelative(target.key, receipt.vaultPath),
  );
  if (file.sha256 !== sha256 || file.sizeBytes !== receipt.size)
    throw new HttpError(409, 'The existing receipt original changed.');
  return { id: receipt.id, vaultPath: receipt.vaultPath };
}

/** Reads and validates originals without creating files, receipts or model decisions. */
export async function prepareMailReceipts(
  input: MailReceiptInput,
  executor: ReceiptDb = db,
): Promise<MailReceiptPlan[]> {
  const [target] = await executor
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, input.projectId));
  const [source] = await executor
    .select({ message: mailMessage, projectId: mailThread.projectId })
    .from(mailMessage)
    .innerJoin(mailThread, eq(mailThread.id, mailMessage.threadId))
    .where(eq(mailMessage.id, input.messageId));
  if (
    !target ||
    !source ||
    target.teamId !== input.teamId ||
    source.message.teamId !== input.teamId
  )
    throw new HttpError(404, 'Mail or project not found');
  if (source.projectId !== input.projectId)
    throw new HttpError(409, 'Move the mail to this project before filing receipts.');
  const attachments = await executor
    .select()
    .from(mailAttachment)
    .where(eq(mailAttachment.messageId, input.messageId));
  if (input.attachmentIds?.some((id) => !attachments.some((attachment) => attachment.id === id)))
    throw new HttpError(400, 'Attachment does not belong to this message.');
  const documents = attachments.filter((a) => /\.(pdf|xml)$/i.test(a.filename));
  const chosen = input.attachmentIds
    ? attachments.filter((a) => input.attachmentIds!.includes(a.id))
    : (documents.length
        ? documents
        : attachments.filter(
            (a) => /\.(png|jpe?g)$/i.test(a.filename) && a.size >= MIN_MAIL_IMAGE_BYTES,
          )
      ).filter((a) => !unrelatedFilename(a.filename) || receiptFilename(a.filename));
  const ibans = await ownIbans(input.projectId, executor);
  const plans: MailReceiptPlan[] = [];
  for (const attachment of chosen) {
    if (!attachment.vaultPath.startsWith(`Projects/${target.key}/`))
      throw new HttpError(409, 'The original attachment is outside this project.');
    assertReceiptFile(attachment.filename);
    const file = await describeVaultFile(
      projectRoot(target.key),
      projectRelative(target.key, attachment.vaultPath),
    );
    if (file.sizeBytes > MAX_RECEIPT_BYTES)
      throw new HttpError(413, 'A receipt may have at most 25 MB.');
    if (file.sha256 !== attachment.sha256 || file.sizeBytes !== attachment.size)
      throw new HttpError(409, 'The original attachment changed after import.');
    const existing = await verifiedExistingMailReceipt(target, attachment.sha256, executor);
    const existingId = existing?.id ?? null;
    const facts = await extractReceiptFile(
      absoluteVaultPath(attachment.vaultPath),
      attachment.filename,
      ibans,
    );
    if (
      !input.attachmentIds &&
      !existingId &&
      !receiptFilename(attachment.filename) &&
      !(facts.grossCents !== null && facts.invoiceNumber)
    )
      continue;
    if (facts.extraction === 'none' && facts.extractionError)
      throw new HttpError(503, `Receipt attachment ${attachment.id} could not be extracted.`);
    facts.details.mailSource = {
      messageId: input.messageId,
      threadId: source.message.threadId,
      kind: 'attachment',
    };
    plans.push({
      attachmentId: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      sha256: attachment.sha256,
      vaultPath: attachment.vaultPath,
      facts,
      existingId,
    });
  }
  if (!plans.length && input.includeBody !== false) {
    const facts = mailReceiptFacts(source.message, ibans);
    if (input.includeBody === true || hasMailReceiptEvidence(source.message.subject, facts)) {
      if (source.message.size > MAX_RECEIPT_BYTES)
        throw new HttpError(413, 'A receipt may have at most 25 MB.');
      const raw = await getObject(source.message.rawKey);
      const reader = raw.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_RECEIPT_BYTES)
            throw new HttpError(413, 'A receipt may have at most 25 MB.');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = Buffer.concat(chunks);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      facts.details.mailSource = {
        messageId: input.messageId,
        threadId: source.message.threadId,
        kind: 'body',
      };
      plans.push({
        attachmentId: null,
        filename: `mail-${sha256.slice(0, 24)}.eml`,
        contentType: 'message/rfc822',
        size,
        sha256,
        vaultPath: null,
        bytes,
        facts,
        existingId: (await verifiedExistingMailReceipt(target, sha256, executor))?.id ?? null,
      });
    }
  }
  if (input.reviewedSource)
    assertReviewedMailSource(input.reviewedSource, {
      accountId: source.message.accountId,
      threadId: source.message.threadId,
      originals: plans,
      originalPair: mailOriginalPair(plans),
    });
  return plans;
}

/** Original attachments stay in Mail; a body receipt preserves the original RFC822 message. */
export async function intakeMailReceipts(input: MailReceiptInput): Promise<number[]> {
  const pairEnabled = await autoMergeEnabled(input.teamId);
  const stored = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(748220, ${input.projectId})`);
    return storeMailReceipts(input, tx, pairEnabled);
  });
  // Indexing and matching use their own DB work. Run only after releasing the intake
  // connection. Existing body receipts remain in indexPaths so a failed index can retry.
  try {
    await indexVaultPaths(
      stored.indexPaths,
      {
        author: input.actorUserId ? `user:${input.actorUserId}` : 'mail-receipts',
      },
      { throwOnError: true },
    );
  } finally {
    // A committed original remains valid if its derived index fails. Match new rows
    // once; a subsequent index-repair retry must not repeat matching existing IDs.
    if (!input.skipMatching) for (const id of stored.newIds) await matchQuietly(id);
  }
  if (stored.newIds.length) await rebuildReceiptProjection(input.projectId);
  return stored.ids;
}

async function storeMailReceipts(
  input: MailReceiptInput,
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  pairEnabled: boolean,
) {
  const plans = await prepareMailReceipts(input, executor);
  const [target] = await executor
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, input.projectId));
  if (!target) throw new HttpError(404, 'Project not found');
  const ids = new Set<number>();
  const newIds: number[] = [];
  const newBySha = new Map<string, number>();
  const indexPaths = new Set<string>();
  for (const plan of plans) {
    const existing = await verifiedExistingMailReceipt(target, plan.sha256, executor);
    if (existing) {
      ids.add(existing.id);
      if (plan.attachmentId === null) indexPaths.add(existing.vaultPath);
      continue;
    }
    let vaultPath = plan.vaultPath;
    if (!vaultPath) {
      const root = projectRoot(target.key);
      const folder = `Files/Belege/${plan.facts.invoiceDate!.slice(0, 7)}`;
      const canonical = `${folder}/${plan.filename}`;
      const previous = await describeVaultFile(root, canonical).catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      });
      if (previous && (previous.sha256 !== plan.sha256 || previous.sizeBytes !== plan.size))
        throw new HttpError(409, 'The archived original changed.');
      const relative = previous
        ? canonical
        : await writeUniqueFile(root, folder, plan.filename, plan.bytes!, undefined, {
            deferIndex: true,
          });
      vaultPath = joinPath(root.vaultPath!, relative);
      indexPaths.add(vaultPath);
    }
    const [row] = await executor
      .insert(helenaReceipt)
      .values({
        teamId: input.teamId,
        projectId: input.projectId,
        source: 'mail',
        mailAttachmentId: plan.attachmentId,
        vaultPath,
        filename: plan.filename,
        contentType: plan.contentType,
        size: plan.size,
        sha256: plan.sha256,
        createdByUserId: input.actorUserId,
        ...extractedColumns(plan.facts),
      })
      .onConflictDoNothing()
      .returning({ id: helenaReceipt.id });
    const id = row?.id ?? (await existingBySha(input.projectId, plan.sha256, executor));
    if (id) ids.add(id);
    if (row) {
      newIds.push(row.id);
      newBySha.set(plan.sha256, row.id);
    }
  }
  const pair = mailOriginalPair(plans);
  const primaryId = pair ? newBySha.get(pair.invoiceSha256) : undefined;
  const supplementaryId = pair ? newBySha.get(pair.receiptSha256) : undefined;
  const intakeDay = new Date().toISOString().slice(0, 10);
  const invoiceDay =
    plans.find((plan) => plan.sha256 === pair?.invoiceSha256)?.facts.invoiceDate ?? intakeDay;
  const paymentDay =
    plans.find((plan) => plan.sha256 === pair?.receiptSha256)?.facts.invoiceDate ?? intakeDay;
  const pairDateFit = Math.abs(Date.parse(invoiceDay) - Date.parse(paymentDay)) <= 7 * 86_400_000;
  // Never recreate a deliberately detached relation on reimport/index repair. Both
  // originals must have been newly inserted in this very transaction.
  if (pairEnabled && pairDateFit && primaryId !== undefined && supplementaryId !== undefined) {
    await linkReceiptOriginalInTransaction(
      executor,
      input.projectId,
      supplementaryId,
      primaryId,
      input.actorUserId,
    );
    await executor.insert(helenaReceiptPairHistory).values({
      projectId: input.projectId,
      teamId: input.teamId,
      receiptId: supplementaryId,
      primaryReceiptId: primaryId,
      action: 'auto_link',
      createdByUserId: input.actorUserId,
    });
  }
  await inspectNewReceipts(executor, input.projectId, newIds, pairEnabled, input.actorUserId);
  return { ids: [...ids], newIds, indexPaths: [...indexPaths] };
}

// The day a receipt belongs to: its invoice date, or the day it arrived.
export const receiptDay = sql`coalesce(${helenaReceipt.invoiceDate}, (${helenaReceipt.createdAt} AT TIME ZONE 'UTC')::date)`;

export async function listReceipts(
  projectId: number,
  filter: { status?: string; month?: string; q?: string; limit?: number },
): Promise<ReceiptView[]> {
  const range = filter.month ? monthRange(filter.month) : null;
  const q = filter.q?.trim();
  const rows = await db
    .select()
    .from(helenaReceipt)
    .where(
      and(
        eq(helenaReceipt.projectId, projectId),
        economicReceipt,
        filter.status ? eq(helenaReceipt.status, filter.status) : undefined,
        range ? inMonth(receiptDay, range) : undefined,
        q
          ? or(
              ilike(helenaReceipt.issuer, `%${q}%`),
              ilike(helenaReceipt.invoiceNumber, `%${q}%`),
              ilike(helenaReceipt.filename, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(receiptDay), desc(helenaReceipt.id))
    .limit(Math.min(filter.limit ?? 500, 2000));
  return receiptViews(rows);
}

export async function getReceipt(
  projectId: number,
  receiptId: number,
  user: AuthUser,
  headers: Headers,
) {
  const row = await requireReceipt(projectId, receiptId);
  const [detail, sourceLinks] = await Promise.all([
    receiptDetailView(row),
    receiptSourceLinks(row, user, headers),
  ]);
  return { ...detail, sourceLinks };
}

export interface ReceiptPatch {
  issuer?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  totalGrossCents?: number | null;
  vatCents?: number | null;
  currency?: string;
  iban?: string | null;
  direction?: 'incoming' | 'outgoing';
  status?: 'open' | 'ignored';
}

// The owner's corrections. A receipt still open is matched again with what it now says.
export async function updateReceipt(
  projectId: number,
  receiptId: number,
  body: ReceiptPatch,
): Promise<ReceiptDetailView> {
  const row = await requireReceipt(projectId, receiptId);
  const patch: Partial<typeof helenaReceipt.$inferInsert> = {};
  const text = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
  if (body.issuer !== undefined) patch.issuer = text(body.issuer);
  if (body.invoiceNumber !== undefined) patch.invoiceNumber = text(body.invoiceNumber);
  if (body.invoiceDate !== undefined) patch.invoiceDate = body.invoiceDate || null;
  if (body.dueDate !== undefined) patch.dueDate = body.dueDate || null;
  if (body.totalGrossCents !== undefined)
    patch.totalGross = body.totalGrossCents === null ? null : centsToNumeric(body.totalGrossCents);
  if (body.vatCents !== undefined)
    patch.vatAmount = body.vatCents === null ? null : centsToNumeric(body.vatCents);
  if (body.currency !== undefined) patch.currency = body.currency.toUpperCase();
  if (body.iban !== undefined)
    patch.iban = text(body.iban)?.replace(/\s+/g, '').toUpperCase() ?? null;
  if (body.direction !== undefined) patch.direction = body.direction;
  if (body.status !== undefined && body.status !== row.status) {
    if (row.status === 'matched')
      throw new HttpError(409, 'The receipt is matched. Remove the match first.');
    patch.status = body.status;
  }
  const corrected = Object.keys(patch).some((key) => key !== 'status');
  if (corrected && row.extraction === 'none') patch.extraction = 'manual';
  if (!Object.keys(patch).length) return receiptDetailView(row);
  await db.transaction(async (tx) => {
    if (patch.status !== undefined) {
      await assertUngroupedReceipt(tx, projectId, receiptId);
      const [current] = await tx
        .select({ status: helenaReceipt.status })
        .from(helenaReceipt)
        .where(eq(helenaReceipt.id, receiptId))
        .for('update');
      if (current?.status === 'matched' && patch.status !== current.status)
        throw new HttpError(409, 'The receipt is matched. Remove the match first.');
    }
    await tx.update(helenaReceipt).set(patch).where(eq(helenaReceipt.id, receiptId));
  });
  if (corrected && (patch.status ?? row.status) === 'open') await matchQuietly(receiptId);
  return viewOf(receiptId);
}

/** Reads the file again (after an OCR program was installed, or with a better parser). */
export async function extractAgain(
  project: Project,
  receiptId: number,
): Promise<ReceiptDetailView> {
  const row = await requireReceipt(project.id, receiptId);
  let facts: ExtractedReceipt;
  try {
    facts = await extractReceiptFile(
      absoluteVaultPath(row.vaultPath),
      row.filename,
      await ownIbans(project.id),
    );
  } catch (error) {
    throw new HttpError(
      404,
      `The receipt's file cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  facts.details = {
    ...facts.details,
    mailSource: (row.details as ExtractedReceipt['details'])?.mailSource,
  };
  await db.update(helenaReceipt).set(extractedColumns(facts)).where(eq(helenaReceipt.id, row.id));
  if (row.status === 'open') await matchQuietly(row.id);
  return viewOf(row.id);
}

// Deletes the receipt row only; its file stays in the vault.
export async function deleteReceipt(projectId: number, receiptId: number): Promise<void> {
  const row = await requireReceipt(projectId, receiptId);
  await db.transaction(async (tx) => {
    await assertUngroupedReceipt(tx, projectId, row.id);
    await unlinkReceipt(tx, row.id);
    await tx.delete(helenaReceipt).where(eq(helenaReceipt.id, row.id));
  });
}

export interface ReceiptSummary {
  month: string | null;
  transactions: { open: number; matched: number; ignored: number };
  receipts: { open: number; matched: number; ignored: number };
  proposals: number;
  months: string[];
}

// The counts behind the page's tabs, for one month or all of them, and the months that have
// transactions or receipts.
export async function receiptSummary(
  projectId: number,
  month: string | null,
): Promise<ReceiptSummary> {
  const range = month ? monthRange(month) : null;
  const [transactions, receipts, proposals, months] = await Promise.all([
    db
      .select({ status: helenaBankTransaction.status, n: count() })
      .from(helenaBankTransaction)
      .where(
        and(
          eq(helenaBankTransaction.projectId, projectId),
          range ? inMonth(sql`${helenaBankTransaction.bookingDate}`, range) : undefined,
        ),
      )
      .groupBy(helenaBankTransaction.status),
    db
      .select({ status: helenaReceipt.status, n: count() })
      .from(helenaReceipt)
      .where(
        and(
          eq(helenaReceipt.projectId, projectId),
          economicReceipt,
          range ? inMonth(receiptDay, range) : undefined,
        ),
      )
      .groupBy(helenaReceipt.status),
    db
      .select({ n: count() })
      .from(helenaReceiptMatch)
      .innerJoin(helenaReceipt, eq(helenaReceipt.id, helenaReceiptMatch.receiptId))
      .where(
        and(
          eq(helenaReceiptMatch.projectId, projectId),
          eq(helenaReceiptMatch.status, 'proposed'),
          economicReceipt,
          range ? inMonth(receiptDay, range) : undefined,
        ),
      ),
    db.execute(sql`
      SELECT month FROM (
        SELECT to_char(${helenaBankTransaction.bookingDate}, 'YYYY-MM') AS month
          FROM ${helenaBankTransaction} WHERE ${helenaBankTransaction.projectId} = ${projectId}
        UNION
        SELECT to_char(${receiptDay}, 'YYYY-MM') AS month
          FROM ${helenaReceipt} WHERE ${helenaReceipt.projectId} = ${projectId} AND ${economicReceipt}
      ) months ORDER BY month DESC LIMIT 120`),
  ]);
  const of = (rows: { status: string; n: number }[], status: string) =>
    rows.find((row) => row.status === status)?.n ?? 0;
  return {
    month,
    transactions: {
      open: of(transactions, 'open'),
      matched: of(transactions, 'matched'),
      ignored: of(transactions, 'ignored'),
    },
    receipts: {
      open: of(receipts, 'open'),
      matched: of(receipts, 'matched'),
      ignored: of(receipts, 'ignored'),
    },
    proposals: proposals[0]?.n ?? 0,
    months: (months as unknown as { month: string }[]).map((row) => row.month),
  };
}
