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
  mailAttachment,
  mailMessage,
  project as projectTable,
} from '@repo/db';
import { absoluteVaultPath } from '@repo/vault';
import { and, count, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { joinPath, relativePath, safeFileName } from '#modules/project-files/paths';
import { projectRoot, projectVaultPath } from '#modules/project-files/roots';
import { contentTypeOf } from '#modules/project-files/serve';
import { describeVaultFile, writeUniqueFile } from '#modules/project-files/service';
import { centsToNumeric, monthRange } from './amounts';
import { extractReceiptFile, isReceiptFile, type ExtractedReceipt } from './extract';
import { matchReceipt, unlinkReceipt } from './matching';
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

export async function ownIbans(projectId: number): Promise<string[]> {
  const rows = await db
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

async function existingBySha(projectId: number, sha256: string): Promise<number | null> {
  const [row] = await db
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
    details: facts.details as Record<string, unknown>,
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
  const month = (facts.invoiceDate ?? new Date().toISOString()).slice(0, 7);
  const root = projectRoot(project.key);
  const relative = await writeUniqueFile(root, `Files/Belege/${month}`, name, bytes);
  const [row] = await db
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
    })
    .returning({ id: helenaReceipt.id });
  await matchQuietly(row!.id);
  return viewOf(row!.id);
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
  const [row] = await db
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
    .returning({ id: helenaReceipt.id });
  await matchQuietly(row!.id);
  return viewOf(row!.id);
}

/**
 * The attachments of an invoice mail as receipts of a project (registered with the mail
 * classifier). Returns the receipts of those attachments, new or already known.
 */
export async function intakeMailReceipts(input: {
  teamId: number;
  projectId: number;
  messageId: number;
  actorUserId: string | null;
}): Promise<number[]> {
  const [target] = await db
    .select({ id: projectTable.id, teamId: projectTable.teamId })
    .from(projectTable)
    .where(eq(projectTable.id, input.projectId));
  const [message] = await db
    .select({ teamId: mailMessage.teamId })
    .from(mailMessage)
    .where(eq(mailMessage.id, input.messageId));
  if (!target || !message || target.teamId !== input.teamId || message.teamId !== input.teamId)
    return [];
  const attachments = await db
    .select()
    .from(mailAttachment)
    .where(eq(mailAttachment.messageId, input.messageId));
  const documents = attachments.filter((a) => /\.(pdf|xml)$/i.test(a.filename));
  const chosen = documents.length
    ? documents
    : attachments.filter(
        (a) => /\.(png|jpe?g)$/i.test(a.filename) && a.size >= MIN_MAIL_IMAGE_BYTES,
      );
  const ibans = await ownIbans(input.projectId);
  const ids: number[] = [];
  const created: number[] = [];
  for (const attachment of chosen) {
    const existing = await existingBySha(input.projectId, attachment.sha256);
    if (existing) {
      ids.push(existing);
      continue;
    }
    let facts: ExtractedReceipt;
    try {
      facts = await extractReceiptFile(
        absoluteVaultPath(attachment.vaultPath),
        attachment.filename,
        ibans,
      );
    } catch (error) {
      console.error(`[receipts] attachment ${attachment.id} not read`, error);
      continue;
    }
    const [row] = await db
      .insert(helenaReceipt)
      .values({
        teamId: input.teamId,
        projectId: input.projectId,
        source: 'mail',
        mailAttachmentId: attachment.id,
        vaultPath: attachment.vaultPath,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        sha256: attachment.sha256,
        createdByUserId: input.actorUserId,
        ...extractedColumns(facts),
      })
      .onConflictDoNothing()
      .returning({ id: helenaReceipt.id });
    if (row) {
      ids.push(row.id);
      created.push(row.id);
    }
  }
  for (const id of created) await matchQuietly(id);
  return ids;
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

export async function getReceipt(projectId: number, receiptId: number) {
  return receiptDetailView(await requireReceipt(projectId, receiptId));
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
  if (body.iban !== undefined) patch.iban = text(body.iban)?.replace(/\s+/g, '').toUpperCase() ?? null;
  if (body.direction !== undefined) patch.direction = body.direction;
  if (body.status !== undefined && body.status !== row.status) {
    if (row.status === 'matched')
      throw new HttpError(409, 'The receipt is matched. Remove the match first.');
    patch.status = body.status;
  }
  const corrected = Object.keys(patch).some((key) => key !== 'status');
  if (corrected && row.extraction === 'none') patch.extraction = 'manual';
  if (!Object.keys(patch).length) return receiptDetailView(row);
  await db.update(helenaReceipt).set(patch).where(eq(helenaReceipt.id, receiptId));
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
  await db.update(helenaReceipt).set(extractedColumns(facts)).where(eq(helenaReceipt.id, row.id));
  if (row.status === 'open') await matchQuietly(row.id);
  return viewOf(row.id);
}

// Deletes the receipt row only; its file stays in the vault.
export async function deleteReceipt(projectId: number, receiptId: number): Promise<void> {
  const row = await requireReceipt(projectId, receiptId);
  await db.transaction(async (tx) => {
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
        and(eq(helenaReceipt.projectId, projectId), range ? inMonth(receiptDay, range) : undefined),
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
          range ? inMonth(receiptDay, range) : undefined,
        ),
      ),
    db.execute(sql`
      SELECT month FROM (
        SELECT to_char(${helenaBankTransaction.bookingDate}, 'YYYY-MM') AS month
          FROM ${helenaBankTransaction} WHERE ${helenaBankTransaction.projectId} = ${projectId}
        UNION
        SELECT to_char(${receiptDay}, 'YYYY-MM') AS month
          FROM ${helenaReceipt} WHERE ${helenaReceipt.projectId} = ${projectId}
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

