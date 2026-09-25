import {
  db,
  helenaBankAccount,
  helenaBankTransaction,
  helenaReceipt,
  helenaReceiptMatch,
} from '@repo/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { numericToCents } from './amounts';
import type { ReceiptDetails } from './extract';

// What the receipts routes return: amounts in integer cents, dates as 'YYYY-MM-DD', and with
// every receipt the transaction it is matched to (and the other way round).

export type ReceiptRow = typeof helenaReceipt.$inferSelect;
export type TransactionRow = typeof helenaBankTransaction.$inferSelect;
export type MatchRow = typeof helenaReceiptMatch.$inferSelect;

export interface MatchedTransaction {
  matchId: number;
  transactionId: number;
  method: string;
  score: number | null;
  confidence: number | null;
  bookingDate: string;
  amountCents: number;
  currency: string;
  counterpartyName: string;
}

export interface ReceiptView {
  id: number;
  source: string;
  filename: string;
  contentType: string;
  size: number;
  vaultPath: string;
  issuer: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  totalGrossCents: number | null;
  vatCents: number | null;
  currency: string;
  iban: string | null;
  direction: string;
  extraction: string;
  extractionError: string | null;
  status: string;
  creditNote: boolean;
  directDebit: boolean;
  einvoice: boolean;
  paymentReference: string | null;
  createdAt: string;
  match: MatchedTransaction | null;
  proposals: number;
}

export interface ReceiptDetailView extends ReceiptView {
  textExcerpt: string | null;
  details: ReceiptDetails;
  mailAttachmentId: number | null;
}

export interface MatchedReceipt {
  matchId: number;
  receiptId: number;
  method: string;
  filename: string;
  issuer: string | null;
  invoiceNumber: string | null;
}

export interface TransactionView {
  id: number;
  bankAccountId: number;
  accountName: string;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string;
  counterpartyName: string;
  counterpartyIban: string | null;
  purpose: string;
  endToEndId: string | null;
  mandateId: string | null;
  creditorId: string | null;
  bankCode: string | null;
  status: string;
  note: string | null;
  receipts: MatchedReceipt[];
}

export function detailsOf(row: ReceiptRow): ReceiptDetails {
  return (row.details ?? {}) as unknown as ReceiptDetails;
}

function baseReceiptView(
  row: ReceiptRow,
  match: MatchedTransaction | null,
  proposals: number,
): ReceiptView {
  const details = detailsOf(row);
  return {
    id: row.id,
    source: row.source,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    vaultPath: row.vaultPath,
    issuer: row.issuer,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    totalGrossCents: numericToCents(row.totalGross),
    vatCents: numericToCents(row.vatAmount),
    currency: row.currency,
    iban: row.iban,
    direction: row.direction,
    extraction: row.extraction,
    extractionError: row.extractionError,
    status: row.status,
    creditNote: details.creditNote === true,
    directDebit: details.directDebit === true,
    einvoice: row.extraction === 'zugferd' || row.extraction === 'xrechnung',
    paymentReference: details.paymentReference ?? null,
    createdAt: row.createdAt.toISOString(),
    match,
    proposals,
  };
}

// The confirmed transaction and the number of open proposals of each receipt.
async function receiptLinks(receiptIds: number[]) {
  const confirmed = new Map<number, MatchedTransaction>();
  const proposals = new Map<number, number>();
  if (!receiptIds.length) return { confirmed, proposals };
  const rows = await db
    .select({
      matchId: helenaReceiptMatch.id,
      receiptId: helenaReceiptMatch.receiptId,
      status: helenaReceiptMatch.status,
      method: helenaReceiptMatch.method,
      score: helenaReceiptMatch.score,
      confidence: helenaReceiptMatch.confidence,
      transactionId: helenaBankTransaction.id,
      bookingDate: helenaBankTransaction.bookingDate,
      amount: helenaBankTransaction.amount,
      currency: helenaBankTransaction.currency,
      counterpartyName: helenaBankTransaction.counterpartyName,
    })
    .from(helenaReceiptMatch)
    .innerJoin(
      helenaBankTransaction,
      eq(helenaBankTransaction.id, helenaReceiptMatch.transactionId),
    )
    .where(
      and(
        inArray(helenaReceiptMatch.receiptId, receiptIds),
        inArray(helenaReceiptMatch.status, ['confirmed', 'proposed']),
      ),
    );
  for (const row of rows) {
    if (row.status === 'proposed') {
      proposals.set(row.receiptId, (proposals.get(row.receiptId) ?? 0) + 1);
      continue;
    }
    confirmed.set(row.receiptId, {
      matchId: row.matchId,
      transactionId: row.transactionId,
      method: row.method,
      score: row.score,
      confidence: row.confidence,
      bookingDate: row.bookingDate,
      amountCents: numericToCents(row.amount) ?? 0,
      currency: row.currency,
      counterpartyName: row.counterpartyName,
    });
  }
  return { confirmed, proposals };
}

export async function receiptViews(rows: ReceiptRow[]): Promise<ReceiptView[]> {
  const { confirmed, proposals } = await receiptLinks(rows.map((row) => row.id));
  return rows.map((row) =>
    baseReceiptView(row, confirmed.get(row.id) ?? null, proposals.get(row.id) ?? 0),
  );
}

export async function receiptDetailView(row: ReceiptRow): Promise<ReceiptDetailView> {
  const [view] = await receiptViews([row]);
  return {
    ...view!,
    textExcerpt: row.textExcerpt,
    details: detailsOf(row),
    mailAttachmentId: row.mailAttachmentId,
  };
}

export async function transactionViews(rows: TransactionRow[]): Promise<TransactionView[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const accountIds = [...new Set(rows.map((row) => row.bankAccountId))];
  const [accounts, links] = await Promise.all([
    db
      .select({ id: helenaBankAccount.id, name: helenaBankAccount.name })
      .from(helenaBankAccount)
      .where(inArray(helenaBankAccount.id, accountIds)),
    db
      .select({
        matchId: helenaReceiptMatch.id,
        transactionId: helenaReceiptMatch.transactionId,
        method: helenaReceiptMatch.method,
        receiptId: helenaReceipt.id,
        filename: helenaReceipt.filename,
        issuer: helenaReceipt.issuer,
        invoiceNumber: helenaReceipt.invoiceNumber,
      })
      .from(helenaReceiptMatch)
      .innerJoin(helenaReceipt, eq(helenaReceipt.id, helenaReceiptMatch.receiptId))
      .where(
        and(
          inArray(helenaReceiptMatch.transactionId, ids),
          eq(helenaReceiptMatch.status, 'confirmed'),
        ),
      ),
  ]);
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  return rows.map((row) => ({
    id: row.id,
    bankAccountId: row.bankAccountId,
    accountName: names.get(row.bankAccountId) ?? '',
    bookingDate: row.bookingDate,
    valueDate: row.valueDate,
    amountCents: numericToCents(row.amount) ?? 0,
    currency: row.currency,
    counterpartyName: row.counterpartyName,
    counterpartyIban: row.counterpartyIban,
    purpose: row.purpose,
    endToEndId: row.endToEndId,
    mandateId: row.mandateId,
    creditorId: row.creditorId,
    bankCode: row.bankCode,
    status: row.status,
    note: row.note,
    receipts: links
      .filter((link) => link.transactionId === row.id)
      .map(({ transactionId: _transaction, ...link }) => link),
  }));
}

// A month filter ([from, to) from monthRange) on a date expression.
export function inMonth(day: SQL, range: { from: string; to: string }) {
  return sql`${day} >= ${range.from}::date AND ${day} < ${range.to}::date`;
}
