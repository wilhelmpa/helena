// Receipt matching (Beleg-Matching, docs/helena-decisions/decisions.md §7): a project's bank
// accounts and the transactions imported from their CAMT.053 or CSV exports, the receipts
// (invoices, bills) that came in by mail, upload or from the vault, and which receipt belongs
// to which transaction. Rules pre-filter the candidates (amount, date window, IBAN, payee); a
// decision model picks one (or none); a confident pick is matched at once, an unsure one waits
// in the review list for the owner.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { project, team } from './app';
import { mailAttachment } from './mail';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const helenaBankAccount = pgTable(
  'helena_bank_account',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Normalized (no spaces, upper case); null for an account known only by its name.
    iban: text('iban'),
    currency: text('currency').notNull().default('EUR'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('helena_bank_account_iban_idx')
      .on(t.projectId, t.iban)
      .where(sql`${t.iban} IS NOT NULL`),
    index('helena_bank_account_project_idx').on(t.projectId),
  ],
);

export const helenaBankImport = pgTable(
  'helena_bank_import',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    bankAccountId: integer('bank_account_id')
      .notNull()
      .references(() => helenaBankAccount.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    // 'camt052' | 'camt053' | 'camt054' | 'csv', or 'zip' for an archive of statements.
    format: text('format').notNull(),
    sha256: text('sha256').notNull(),
    entries: integer('entries').notNull().default(0),
    added: integer('added').notNull().default(0),
    duplicates: integer('duplicates').notNull().default(0),
    fromDate: date('from_date'),
    toDate: date('to_date'),
    // What the parser noticed: balances that do not add up, files it skipped, statements of
    // another account.
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'helena_bank_import_format_check',
      sql`${t.format} IN ('camt052', 'camt053', 'camt054', 'csv', 'zip')`,
    ),
    index('helena_bank_import_account_idx').on(t.bankAccountId, t.createdAt.desc()),
  ],
);

export const helenaBankTransaction = pgTable(
  'helena_bank_transaction',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    bankAccountId: integer('bank_account_id')
      .notNull()
      .references(() => helenaBankAccount.id, { onDelete: 'cascade' }),
    importId: integer('import_id').references(() => helenaBankImport.id, {
      onDelete: 'set null',
    }),
    bookingDate: date('booking_date').notNull(),
    valueDate: date('value_date'),
    // Signed: a payment out is negative.
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('EUR'),
    counterpartyName: text('counterparty_name').notNull().default(''),
    counterpartyIban: text('counterparty_iban'),
    // Verwendungszweck (remittance information).
    purpose: text('purpose').notNull().default(''),
    endToEndId: text('end_to_end_id'),
    mandateId: text('mandate_id'),
    creditorId: text('creditor_id'),
    // The bank's own reference and transaction code (BkTxCd / GVC), where the export has them.
    bankReference: text('bank_reference'),
    bankCode: text('bank_code'),
    // Stable across re-imports of overlapping statements.
    dedupeKey: text('dedupe_key').notNull(),
    // open | matched | ignored (no receipt needed: a transfer between own accounts, a salary).
    status: text('status').notNull().default('open'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'helena_bank_transaction_status_check',
      sql`${t.status} IN ('open', 'matched', 'ignored')`,
    ),
    uniqueIndex('helena_bank_transaction_dedupe_idx').on(t.bankAccountId, t.dedupeKey),
    index('helena_bank_transaction_project_date_idx').on(t.projectId, t.bookingDate.desc()),
  ],
);

export const helenaReceipt = pgTable(
  'helena_receipt',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    // 'mail' | 'upload' | 'vault'
    source: text('source').notNull(),
    mailAttachmentId: integer('mail_attachment_id').references(() => mailAttachment.id, {
      onDelete: 'set null',
    }),
    // The file in the project's vault.
    vaultPath: text('vault_path').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    sha256: text('sha256').notNull(),
    // What was read from it.
    issuer: text('issuer'),
    invoiceNumber: text('invoice_number'),
    invoiceDate: date('invoice_date'),
    dueDate: date('due_date'),
    totalGross: numeric('total_gross', { precision: 14, scale: 2 }),
    currency: text('currency').notNull().default('EUR'),
    iban: text('iban'),
    vatAmount: numeric('vat_amount', { precision: 14, scale: 2 }),
    // 'incoming' (a bill to pay) or 'outgoing' (an invoice the project wrote).
    direction: text('direction').notNull().default('incoming'),
    // How: 'zugferd' | 'xrechnung' | 'text' | 'ocr' | 'manual' | 'none'.
    extraction: text('extraction').notNull().default('none'),
    extractionError: text('extraction_error'),
    // The first characters of the text, for the matching question and the review list.
    textExcerpt: text('text_excerpt'),
    // The rest of what the e-invoice or the text said that matching uses (payment reference,
    // creditor id and mandate of a direct debit, Skonto, amount due, buyer, credit note) and
    // where its XML is: embedded in the PDF or the file itself (@helena/finance InvoiceFacts).
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    // open | matched | ignored
    status: text('status').notNull().default('open'),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    check('helena_receipt_source_check', sql`${t.source} IN ('mail', 'upload', 'vault')`),
    check('helena_receipt_status_check', sql`${t.status} IN ('open', 'matched', 'ignored')`),
    check('helena_receipt_direction_check', sql`${t.direction} IN ('incoming', 'outgoing')`),
    uniqueIndex('helena_receipt_scope_idx').on(t.id, t.projectId, t.teamId),
    uniqueIndex('helena_receipt_file_idx').on(t.projectId, t.sha256),
    index('helena_receipt_project_idx').on(t.projectId, t.createdAt.desc()),
  ],
);

export const helenaReceiptMatch = pgTable(
  'helena_receipt_match',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    receiptId: integer('receipt_id')
      .notNull()
      .references(() => helenaReceipt.id, { onDelete: 'cascade' }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => helenaBankTransaction.id, { onDelete: 'cascade' }),
    // proposed (waits for the owner) | confirmed (matched) | rejected (the owner said no).
    status: text('status').notNull(),
    // rule (one candidate that fits exactly) | decision (the decision model) | manual.
    method: text('method').notNull(),
    // How well the rules say the pair fits (0–1), and the decision's confidence.
    score: doublePrecision('score'),
    confidence: doublePrecision('confidence'),
    decisionId: bigint('decision_id', { mode: 'number' }),
    decidedByUserId: text('decided_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'helena_receipt_match_status_check',
      sql`${t.status} IN ('proposed', 'confirmed', 'rejected')`,
    ),
    check('helena_receipt_match_method_check', sql`${t.method} IN ('rule', 'decision', 'manual')`),
    uniqueIndex('helena_receipt_match_pair_idx').on(t.receiptId, t.transactionId),
    // One confirmed transaction per receipt.
    uniqueIndex('helena_receipt_match_confirmed_idx')
      .on(t.receiptId)
      .where(sql`${t.status} = 'confirmed'`),
    index('helena_receipt_match_project_idx').on(t.projectId, t.status),
  ],
);

// Explicit supplementary originals. The original rows and extracted facts remain untouched.
export const helenaReceiptOriginalLink = pgTable(
  'helena_receipt_original_link',
  {
    receiptId: integer('receipt_id').primaryKey(),
    primaryReceiptId: integer('primary_receipt_id').notNull(),
    projectId: integer('project_id').notNull(),
    teamId: integer('team_id').notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('helena_receipt_original_distinct', sql`${t.receiptId} <> ${t.primaryReceiptId}`),
    foreignKey({
      columns: [t.receiptId, t.projectId, t.teamId],
      foreignColumns: [helenaReceipt.id, helenaReceipt.projectId, helenaReceipt.teamId],
      name: 'helena_receipt_original_child_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.primaryReceiptId, t.projectId, t.teamId],
      foreignColumns: [helenaReceipt.id, helenaReceipt.projectId, helenaReceipt.teamId],
      name: 'helena_receipt_original_primary_fk',
    }).onDelete('cascade'),
    index('helena_receipt_original_primary_idx').on(t.primaryReceiptId),
  ],
);

export const helenaReceiptPairSuggestion = pgTable(
  'helena_receipt_pair_suggestion',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    receiptId: integer('receipt_id')
      .notNull()
      .references(() => helenaReceipt.id, { onDelete: 'cascade' }),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => helenaReceipt.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('pending'),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('helena_receipt_pair_suggestion_distinct', sql`${t.receiptId} <> ${t.candidateId}`),
    check('helena_receipt_pair_suggestion_kind', sql`${t.kind} IN ('pair', 'duplicate')`),
    check(
      'helena_receipt_pair_suggestion_status',
      sql`${t.status} IN ('pending', 'linked', 'ignored')`,
    ),
    foreignKey({
      columns: [t.receiptId, t.projectId, t.teamId],
      foreignColumns: [helenaReceipt.id, helenaReceipt.projectId, helenaReceipt.teamId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.candidateId, t.projectId, t.teamId],
      foreignColumns: [helenaReceipt.id, helenaReceipt.projectId, helenaReceipt.teamId],
    }).onDelete('cascade'),
    uniqueIndex('helena_receipt_pair_suggestion_pair_idx').on(t.receiptId, t.candidateId),
    index('helena_receipt_pair_suggestion_project_idx').on(t.projectId, t.status),
  ],
);

export const helenaReceiptPairHistory = pgTable(
  'helena_receipt_pair_history',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    receiptId: integer('receipt_id')
      .notNull()
      .references(() => helenaReceipt.id, { onDelete: 'cascade' }),
    primaryReceiptId: integer('primary_receipt_id')
      .notNull()
      .references(() => helenaReceipt.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('helena_receipt_pair_history_action', sql`${t.action} IN ('auto_link', 'unlink')`),
    foreignKey({
      columns: [t.receiptId, t.projectId, t.teamId],
      foreignColumns: [helenaReceipt.id, helenaReceipt.projectId, helenaReceipt.teamId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.primaryReceiptId, t.projectId, t.teamId],
      foreignColumns: [helenaReceipt.id, helenaReceipt.projectId, helenaReceipt.teamId],
    }).onDelete('cascade'),
    index('helena_receipt_pair_history_project_idx').on(t.projectId, t.createdAt.desc()),
  ],
);
