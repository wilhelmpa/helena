import { t } from 'elysia';

// The shapes of the receipts routes. Amounts are integer cents, dates 'YYYY-MM-DD'.

const nullableString = t.Nullable(t.String());
const nullableNumber = t.Nullable(t.Number());

export const monthPattern = t.String({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' });

export const MatchedTransaction = t.Object({
  matchId: t.Number(),
  transactionId: t.Number(),
  method: t.String(),
  score: nullableNumber,
  confidence: nullableNumber,
  bookingDate: t.String(),
  amountCents: t.Number(),
  currency: t.String(),
  counterpartyName: t.String(),
});

export const Receipt = t.Object({
  id: t.Number(),
  source: t.String(),
  filename: t.String(),
  contentType: t.String(),
  size: t.Number(),
  vaultPath: t.String(),
  issuer: nullableString,
  invoiceNumber: nullableString,
  invoiceDate: nullableString,
  dueDate: nullableString,
  totalGrossCents: nullableNumber,
  vatCents: nullableNumber,
  currency: t.String(),
  iban: nullableString,
  direction: t.String(),
  extraction: t.String(),
  extractionError: nullableString,
  status: t.String(),
  creditNote: t.Boolean(),
  directDebit: t.Boolean(),
  einvoice: t.Boolean(),
  paymentReference: nullableString,
  createdAt: t.String(),
  match: t.Nullable(MatchedTransaction),
  proposals: t.Number(),
});

export const ReceiptDetail = t.Composite([
  Receipt,
  t.Object({
    textExcerpt: nullableString,
    details: t.Record(t.String(), t.Unknown()),
    mailAttachmentId: nullableNumber,
  }),
]);

export const Transaction = t.Object({
  id: t.Number(),
  bankAccountId: t.Number(),
  accountName: t.String(),
  bookingDate: t.String(),
  valueDate: nullableString,
  amountCents: t.Number(),
  currency: t.String(),
  counterpartyName: t.String(),
  counterpartyIban: nullableString,
  purpose: t.String(),
  endToEndId: nullableString,
  mandateId: nullableString,
  creditorId: nullableString,
  bankCode: nullableString,
  status: t.String(),
  note: nullableString,
  receipts: t.Array(
    t.Object({
      matchId: t.Number(),
      receiptId: t.Number(),
      method: t.String(),
      filename: t.String(),
      issuer: nullableString,
      invoiceNumber: nullableString,
    }),
  ),
});

export const Account = t.Object({
  id: t.Number(),
  name: t.String(),
  iban: nullableString,
  currency: t.String(),
  createdAt: t.String(),
  transactions: t.Number(),
  open: t.Number(),
  matched: t.Number(),
  ignored: t.Number(),
  lastImport: t.Nullable(
    t.Object({ id: t.Number(), filename: t.String(), createdAt: t.String(), added: t.Number() }),
  ),
});

export const Import = t.Object({
  id: t.Number(),
  bankAccountId: t.Number(),
  filename: t.String(),
  format: t.String(),
  entries: t.Number(),
  added: t.Number(),
  duplicates: t.Number(),
  fromDate: nullableString,
  toDate: nullableString,
  warnings: t.Array(t.String()),
  createdAt: t.String(),
});

export const ImportResult = t.Composite([
  Import,
  t.Object({
    pending: t.Number(),
    skipped: t.Array(t.Object({ name: t.String(), reason: t.String() })),
    matched: t.Number(),
  }),
]);

export const Candidate = t.Object({
  transaction: Transaction,
  score: t.Number(),
  amount: t.String(),
  reference: t.Boolean(),
  identity: nullableString,
  dateFit: t.String(),
  signals: t.Array(t.String()),
});

export const ReviewItem = t.Object({
  matchId: t.Number(),
  method: t.String(),
  score: nullableNumber,
  confidence: nullableNumber,
  receipt: Receipt,
  transaction: Transaction,
  candidates: t.Array(Candidate),
});

const statusCounts = t.Object({ open: t.Number(), matched: t.Number(), ignored: t.Number() });

export const Summary = t.Object({
  month: nullableString,
  transactions: statusCounts,
  receipts: statusCounts,
  proposals: t.Number(),
  months: t.Array(t.String()),
});

export const MatchOutcome = t.Object({
  status: t.String(),
  matchId: nullableNumber,
  transactionId: nullableNumber,
  method: nullableString,
  decision: t.Nullable(
    t.Object({ status: t.String(), choice: nullableString, confidence: nullableNumber }),
  ),
});

export const Duplicate = t.Object({
  error: t.String(),
  code: t.Optional(t.String()),
  existingId: t.Optional(t.Number()),
});

export const accountBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  iban: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
  currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
});

export const accountPatch = t.Partial(accountBody);

export const receiptPatch = t.Object({
  issuer: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
  invoiceNumber: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  invoiceDate: t.Optional(t.Nullable(t.String({ format: 'date' }))),
  dueDate: t.Optional(t.Nullable(t.String({ format: 'date' }))),
  totalGrossCents: t.Optional(t.Nullable(t.Integer())),
  vatCents: t.Optional(t.Nullable(t.Integer())),
  currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
  iban: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
  direction: t.Optional(t.UnionEnum(['incoming', 'outgoing'])),
  status: t.Optional(t.UnionEnum(['open', 'ignored'])),
});

export const transactionPatch = t.Object({
  status: t.Optional(t.UnionEnum(['open', 'ignored'])),
  note: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
});

export const listQuery = t.Object({
  status: t.Optional(t.UnionEnum(['open', 'matched', 'ignored'])),
  month: t.Optional(monthPattern),
  q: t.Optional(t.String({ maxLength: 200 })),
  accountId: t.Optional(t.Numeric()),
});
