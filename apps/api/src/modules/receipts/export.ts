import { buildMonthExport, type ExportReceipt, type ExportRow } from '@helena/finance';
import {
  db,
  helenaBankAccount,
  helenaBankTransaction,
  helenaReceipt,
  helenaReceiptMatch,
} from '@repo/db';
import { absoluteVaultPath, readVaultFile } from '@repo/vault';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { monthRange, numericToCents } from './amounts';
import { readEmbeddedInvoice } from './extract';
import { detailsOf, inMonth, type ReceiptRow } from './views';

// The month's handover for the tax advisor (docs/helena-decisions/decisions.md §7): every
// transaction of the month with its receipts, the receipts of the month without a payment,
// the files themselves, and the XML of an e-invoice next to its PDF.

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const ASSIGNMENT: Record<string, ExportRow['assignment']> = {
  rule: 'auto',
  decision: 'ai',
  manual: 'manual',
};

function exportReceipt(row: ReceiptRow): ExportReceipt {
  return {
    id: row.id,
    filename: row.filename,
    vaultPath: row.vaultPath,
    issuer: row.issuer,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    grossCents: numericToCents(row.totalGross),
    vatCents: numericToCents(row.vatAmount),
    currency: row.currency,
    einvoice: row.extraction === 'zugferd' || row.extraction === 'xrechnung',
  };
}

export async function monthExport(
  project: { id: number; key: string; name: string },
  month: string,
): Promise<{ zip: Uint8Array; filename: string; files: number }> {
  const range = monthRange(month);
  const transactions = await db
    .select({ transaction: helenaBankTransaction, account: helenaBankAccount })
    .from(helenaBankTransaction)
    .innerJoin(helenaBankAccount, eq(helenaBankAccount.id, helenaBankTransaction.bankAccountId))
    .where(
      and(
        eq(helenaBankTransaction.projectId, project.id),
        inMonth(sql`${helenaBankTransaction.bookingDate}`, range),
      ),
    )
    .orderBy(asc(helenaBankTransaction.bookingDate), asc(helenaBankTransaction.id));
  const matches = transactions.length
    ? await db
        .select({ match: helenaReceiptMatch, receipt: helenaReceipt })
        .from(helenaReceiptMatch)
        .innerJoin(helenaReceipt, eq(helenaReceipt.id, helenaReceiptMatch.receiptId))
        .where(
          and(
            inArray(
              helenaReceiptMatch.transactionId,
              transactions.map((row) => row.transaction.id),
            ),
            eq(helenaReceiptMatch.status, 'confirmed'),
          ),
        )
    : [];
  const day = sql`coalesce(${helenaReceipt.invoiceDate}, (${helenaReceipt.createdAt} AT TIME ZONE 'UTC')::date)`;
  const unpaid = await db
    .select()
    .from(helenaReceipt)
    .where(
      and(
        eq(helenaReceipt.projectId, project.id),
        eq(helenaReceipt.status, 'open'),
        inMonth(day, range),
      ),
    );

  const receipts = new Map<number, ReceiptRow>();
  for (const { receipt } of matches) receipts.set(receipt.id, receipt);
  for (const receipt of unpaid) receipts.set(receipt.id, receipt);
  // The ZIP is built synchronously, so every file is read first.
  const files = new Map<number, Uint8Array>();
  const xmls = new Map<number, Uint8Array>();
  for (const receipt of receipts.values()) {
    const file = await readVaultFile(receipt.vaultPath, MAX_FILE_BYTES).catch(() => null);
    if (file) files.set(receipt.id, file.bytes);
    const einvoice = detailsOf(receipt).einvoice;
    if (file && einvoice?.kind === 'embedded') {
      const embedded = await readEmbeddedInvoice(
        absoluteVaultPath(receipt.vaultPath),
        einvoice.name,
      ).catch(() => null);
      if (embedded) xmls.set(receipt.id, new TextEncoder().encode(embedded.xml));
    }
  }

  const rows: ExportRow[] = transactions.map(({ transaction, account }) => {
    const own = matches.filter((m) => m.match.transactionId === transaction.id);
    const first = own[0]?.match;
    return {
      bookingDate: transaction.bookingDate,
      valueDate: transaction.valueDate,
      amountCents: numericToCents(transaction.amount) ?? 0,
      currency: transaction.currency,
      counterpartyName: transaction.counterpartyName,
      counterpartyIban: transaction.counterpartyIban,
      purpose: transaction.purpose,
      accountIban: account.iban,
      accountLabel: account.name,
      status:
        transaction.status === 'ignored' ? 'no-receipt-needed' : own.length ? 'matched' : 'open',
      assignment: first ? (ASSIGNMENT[first.method] ?? null) : null,
      confidence: first ? (first.confidence ?? first.score ?? null) : null,
      note: transaction.note,
      receipts: own.map((m) => exportReceipt(m.receipt)),
    };
  });
  const built = buildMonthExport({
    month,
    label: project.name,
    rows,
    receiptsWithoutPayment: unpaid.map(exportReceipt),
    fileOf: (receipt) => files.get(receipt.id) ?? null,
    xmlOf: (receipt) => xmls.get(receipt.id) ?? null,
  });
  return {
    zip: built.zip,
    filename: `Helena-Belege_${project.key}_${month}.zip`,
    files: built.files,
  };
}
