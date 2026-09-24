import { createHash } from 'node:crypto';
import { dedupeEntries, normalizeIban, parseBankFile, type BankStatement } from '@helena/finance';
import {
  db,
  helenaBankAccount,
  helenaBankImport,
  helenaBankTransaction,
  helenaReceipt,
  helenaReceiptMatch,
} from '@repo/db';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { centsToNumeric, monthRange } from './amounts';
import { rematchOpenReceipts } from './matching';
import { inMonth, transactionViews, type TransactionView } from './views';

// A project's bank accounts, the statements imported into them (CAMT.052/053/054 XML, the
// ZIP a bank delivers them in, or a CSV export) and the transactions they hold. Re-importing
// an overlapping statement adds only what is new: every entry has a stable dedupe key.

export const MAX_STATEMENT_BYTES = 20 * 1024 * 1024;

export interface AccountView {
  id: number;
  name: string;
  iban: string | null;
  currency: string;
  createdAt: string;
  transactions: number;
  open: number;
  matched: number;
  ignored: number;
  lastImport: { id: number; filename: string; createdAt: string; added: number } | null;
}

export interface ImportView {
  id: number;
  bankAccountId: number;
  filename: string;
  format: string;
  entries: number;
  added: number;
  duplicates: number;
  fromDate: string | null;
  toDate: string | null;
  warnings: string[];
  createdAt: string;
}

export interface ImportResult extends ImportView {
  // Entries the bank marks as not booked yet (vorgemerkt); they come again once booked.
  pending: number;
  skipped: { name: string; reason: string }[];
  // Receipts the new transactions matched right away.
  matched: number;
}

type ImportRow = typeof helenaBankImport.$inferSelect;

function importView(row: ImportRow): ImportView {
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    filename: row.filename,
    format: row.format,
    entries: row.entries,
    added: row.added,
    duplicates: row.duplicates,
    fromDate: row.fromDate,
    toDate: row.toDate,
    warnings: row.warnings ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

function cleanIban(value: string | null | undefined): string | null {
  if (value === undefined || value === null || !value.trim()) return null;
  const iban = normalizeIban(value);
  if (!iban) throw new HttpError(400, 'The IBAN is not valid.');
  return iban;
}

export async function requireAccount(projectId: number, accountId: number) {
  const [row] = await db
    .select()
    .from(helenaBankAccount)
    .where(and(eq(helenaBankAccount.id, accountId), eq(helenaBankAccount.projectId, projectId)));
  if (!row) throw new HttpError(404, 'Bank account not found');
  return row;
}

export async function listAccounts(projectId: number): Promise<AccountView[]> {
  const accounts = await db
    .select()
    .from(helenaBankAccount)
    .where(eq(helenaBankAccount.projectId, projectId))
    .orderBy(asc(helenaBankAccount.name));
  if (!accounts.length) return [];
  const ids = accounts.map((account) => account.id);
  const [counts, imports] = await Promise.all([
    db
      .select({
        accountId: helenaBankTransaction.bankAccountId,
        status: helenaBankTransaction.status,
        n: count(),
      })
      .from(helenaBankTransaction)
      .where(inArray(helenaBankTransaction.bankAccountId, ids))
      .groupBy(helenaBankTransaction.bankAccountId, helenaBankTransaction.status),
    db
      .selectDistinctOn([helenaBankImport.bankAccountId])
      .from(helenaBankImport)
      .where(inArray(helenaBankImport.bankAccountId, ids))
      .orderBy(helenaBankImport.bankAccountId, desc(helenaBankImport.createdAt)),
  ]);
  return accounts.map((account) => {
    const of = (status: string) =>
      counts.find((row) => row.accountId === account.id && row.status === status)?.n ?? 0;
    const last = imports.find((row) => row.bankAccountId === account.id);
    return {
      id: account.id,
      name: account.name,
      iban: account.iban,
      currency: account.currency,
      createdAt: account.createdAt.toISOString(),
      transactions: of('open') + of('matched') + of('ignored'),
      open: of('open'),
      matched: of('matched'),
      ignored: of('ignored'),
      lastImport: last
        ? {
            id: last.id,
            filename: last.filename,
            createdAt: last.createdAt.toISOString(),
            added: last.added,
          }
        : null,
    };
  });
}

async function accountView(projectId: number, accountId: number): Promise<AccountView> {
  const found = (await listAccounts(projectId)).find((account) => account.id === accountId);
  if (!found) throw new HttpError(404, 'Bank account not found');
  return found;
}

async function assertIbanFree(projectId: number, iban: string, exceptId?: number) {
  const [other] = await db
    .select({ id: helenaBankAccount.id })
    .from(helenaBankAccount)
    .where(and(eq(helenaBankAccount.projectId, projectId), eq(helenaBankAccount.iban, iban)));
  if (other && other.id !== exceptId)
    throw new HttpError(409, 'Another account of this project has this IBAN.');
}

export async function createAccount(
  project: { id: number; teamId: number },
  body: { name: string; iban?: string | null; currency?: string },
): Promise<AccountView> {
  const iban = cleanIban(body.iban);
  if (iban) await assertIbanFree(project.id, iban);
  const [row] = await db
    .insert(helenaBankAccount)
    .values({
      teamId: project.teamId,
      projectId: project.id,
      name: body.name.trim(),
      iban,
      currency: (body.currency ?? 'EUR').toUpperCase(),
    })
    .returning({ id: helenaBankAccount.id });
  return accountView(project.id, row!.id);
}

export async function updateAccount(
  projectId: number,
  accountId: number,
  body: { name?: string; iban?: string | null; currency?: string },
): Promise<AccountView> {
  await requireAccount(projectId, accountId);
  const patch: Partial<typeof helenaBankAccount.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.currency !== undefined) patch.currency = body.currency.toUpperCase();
  if (body.iban !== undefined) {
    patch.iban = cleanIban(body.iban);
    if (patch.iban) await assertIbanFree(projectId, patch.iban, accountId);
  }
  if (Object.keys(patch).length)
    await db.update(helenaBankAccount).set(patch).where(eq(helenaBankAccount.id, accountId));
  return accountView(projectId, accountId);
}

// Deleting an account takes its transactions and their matches with it; the receipts that were
// matched to one of them are open again.
export async function deleteAccount(projectId: number, accountId: number): Promise<void> {
  await requireAccount(projectId, accountId);
  await db.transaction(async (tx) => {
    const matched = await tx
      .select({ receiptId: helenaReceiptMatch.receiptId })
      .from(helenaReceiptMatch)
      .innerJoin(
        helenaBankTransaction,
        eq(helenaBankTransaction.id, helenaReceiptMatch.transactionId),
      )
      .where(
        and(
          eq(helenaBankTransaction.bankAccountId, accountId),
          eq(helenaReceiptMatch.status, 'confirmed'),
        ),
      );
    await tx.delete(helenaBankAccount).where(eq(helenaBankAccount.id, accountId));
    const receiptIds = matched.map((row) => row.receiptId);
    if (receiptIds.length)
      await tx
        .update(helenaReceipt)
        .set({ status: 'open' })
        .where(and(inArray(helenaReceipt.id, receiptIds), eq(helenaReceipt.status, 'matched')));
  });
}

export async function listImports(projectId: number, accountId?: number): Promise<ImportView[]> {
  const rows = await db
    .select()
    .from(helenaBankImport)
    .where(
      and(
        eq(helenaBankImport.projectId, projectId),
        accountId ? eq(helenaBankImport.bankAccountId, accountId) : undefined,
      ),
    )
    .orderBy(desc(helenaBankImport.createdAt))
    .limit(200);
  return rows.map(importView);
}

function fileFormat(filename: string, statements: BankStatement[]): string {
  if (/\.zip$/i.test(filename)) return 'zip';
  return statements[0]?.format ?? 'csv';
}

/**
 * Imports a statement file into an account. Statements of another IBAN in the file are left
 * out (with a warning); an account without an IBAN takes the one of the first statement.
 * Pending entries are skipped: the booked entry comes with a later statement.
 */
export async function importStatement(
  project: { id: number; teamId: number },
  accountId: number,
  file: File,
  userId: string,
): Promise<ImportResult> {
  const account = await requireAccount(project.id, accountId);
  if (file.size > MAX_STATEMENT_BYTES)
    throw new HttpError(413, 'A statement file may have at most 20 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseBankFile(bytes, file.name);
  if (!parsed.statements.length) {
    const reason = parsed.skipped.map((entry) => `${entry.name}: ${entry.reason}`).join('; ');
    throw new HttpError(400, `No bank statement found in the file. ${reason}`.trim());
  }

  const warnings: string[] = [];
  let iban = account.iban;
  if (!iban) {
    const first = parsed.statements.find((statement) => statement.accountIban)?.accountIban;
    const normalized = first ? normalizeIban(first) : null;
    if (normalized) {
      const [other] = await db
        .select({ id: helenaBankAccount.id })
        .from(helenaBankAccount)
        .where(
          and(eq(helenaBankAccount.projectId, project.id), eq(helenaBankAccount.iban, normalized)),
        );
      if (other)
        throw new HttpError(409, `The file is for ${normalized}, which is another account here.`);
      await db
        .update(helenaBankAccount)
        .set({ iban: normalized })
        .where(eq(helenaBankAccount.id, account.id));
      iban = normalized;
    }
  }
  const accepted = parsed.statements.filter((statement) => {
    const statementIban = statement.accountIban ? normalizeIban(statement.accountIban) : null;
    if (!statementIban || !iban || statementIban === iban) return true;
    warnings.push(`statement for ${statementIban} skipped: another account`);
    return false;
  });
  for (const statement of accepted) warnings.push(...statement.warnings);
  for (const entry of parsed.skipped) warnings.push(`${entry.name}: ${entry.reason}`);

  const booked = accepted.flatMap((statement) =>
    statement.entries.filter((entry) => entry.status === 'booked'),
  );
  const pending = accepted.reduce(
    (total, statement) => total + statement.entries.filter((e) => e.status === 'pending').length,
    0,
  );
  // The key's account part is the account row, so it stays the same when the IBAN is set later.
  const keyed = dedupeEntries(`account:${account.id}`, booked);
  const dates = booked.map((entry) => entry.bookingDate).sort();

  return db.transaction(async (tx) => {
    const [record] = await tx
      .insert(helenaBankImport)
      .values({
        teamId: project.teamId,
        projectId: project.id,
        bankAccountId: account.id,
        filename: file.name.slice(0, 255),
        format: fileFormat(file.name, accepted),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        entries: keyed.length,
        fromDate: dates[0] ?? null,
        toDate: dates.at(-1) ?? null,
        warnings: warnings.slice(0, 50),
        createdByUserId: userId,
      })
      .returning();
    let added = 0;
    for (let start = 0; start < keyed.length; start += 500) {
      const inserted = await tx
        .insert(helenaBankTransaction)
        .values(
          keyed.slice(start, start + 500).map((entry) => ({
            teamId: project.teamId,
            projectId: project.id,
            bankAccountId: account.id,
            importId: record!.id,
            bookingDate: entry.bookingDate,
            valueDate: entry.valueDate,
            amount: centsToNumeric(entry.amountCents),
            currency: entry.currency || account.currency,
            counterpartyName: entry.counterpartyName,
            counterpartyIban: entry.counterpartyIban,
            purpose: entry.purpose,
            endToEndId: entry.endToEndId,
            mandateId: entry.mandateId,
            creditorId: entry.creditorId,
            bankReference: entry.bankReference,
            bankCode: entry.bankCode,
            dedupeKey: entry.dedupeKey,
          })),
        )
        .onConflictDoNothing({
          target: [helenaBankTransaction.bankAccountId, helenaBankTransaction.dedupeKey],
        })
        .returning({ id: helenaBankTransaction.id });
      added += inserted.length;
    }
    const [row] = await tx
      .update(helenaBankImport)
      .set({ added, duplicates: keyed.length - added })
      .where(eq(helenaBankImport.id, record!.id))
      .returning();
    return { ...importView(row!), pending, skipped: parsed.skipped, matched: 0 };
  }).then(async (result) => {
    // New transactions can pay receipts that waited for them.
    if (result.added > 0) result.matched = await rematchOpenReceipts(project.id);
    return result;
  });
}

export async function listTransactions(
  projectId: number,
  filter: { status?: string; month?: string; q?: string; accountId?: number; limit?: number },
): Promise<TransactionView[]> {
  const range = filter.month ? monthRange(filter.month) : null;
  const q = filter.q?.trim();
  const rows = await db
    .select()
    .from(helenaBankTransaction)
    .where(
      and(
        eq(helenaBankTransaction.projectId, projectId),
        filter.status ? eq(helenaBankTransaction.status, filter.status) : undefined,
        filter.accountId ? eq(helenaBankTransaction.bankAccountId, filter.accountId) : undefined,
        range ? inMonth(sql`${helenaBankTransaction.bookingDate}`, range) : undefined,
        q
          ? or(
              ilike(helenaBankTransaction.counterpartyName, `%${q}%`),
              ilike(helenaBankTransaction.purpose, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(helenaBankTransaction.bookingDate), desc(helenaBankTransaction.id))
    .limit(Math.min(filter.limit ?? 500, 2000));
  return transactionViews(rows);
}

export async function requireTransaction(projectId: number, transactionId: number) {
  const [row] = await db
    .select()
    .from(helenaBankTransaction)
    .where(
      and(
        eq(helenaBankTransaction.id, transactionId),
        eq(helenaBankTransaction.projectId, projectId),
      ),
    );
  if (!row) throw new HttpError(404, 'Transaction not found');
  return row;
}

// "Kein Beleg nötig" (ignored) and back; a matched transaction is unmatched first.
export async function updateTransaction(
  projectId: number,
  transactionId: number,
  body: { status?: 'open' | 'ignored'; note?: string | null },
): Promise<TransactionView> {
  const row = await requireTransaction(projectId, transactionId);
  const patch: Partial<typeof helenaBankTransaction.$inferInsert> = {};
  if (body.status !== undefined && body.status !== row.status) {
    if (row.status === 'matched')
      throw new HttpError(409, 'The transaction has a receipt. Remove the match first.');
    patch.status = body.status;
  }
  if (body.note !== undefined) patch.note = body.note?.trim() || null;
  const [updated] = Object.keys(patch).length
    ? await db
        .update(helenaBankTransaction)
        .set(patch)
        .where(eq(helenaBankTransaction.id, transactionId))
        .returning()
    : [row];
  const [view] = await transactionViews([updated!]);
  return view!;
}
