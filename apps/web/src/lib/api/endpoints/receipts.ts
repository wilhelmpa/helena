import { API_URL, apiFailure, request, uploadFile } from '@/lib/api/core/client';

// Receipt matching (apps/api/src/modules/receipts, docs/helena-decisions/decisions.md §7): a
// project's bank accounts and statement imports, its receipts, the matches between them, the
// review list and the month's export. Amounts are integer cents, dates 'YYYY-MM-DD'.

export type ReceiptStatus = 'open' | 'matched' | 'ignored';
export type MatchMethod = 'rule' | 'decision' | 'manual';

export interface MatchedTransaction {
  matchId: number;
  transactionId: number;
  method: MatchMethod;
  score: number | null;
  confidence: number | null;
  bookingDate: string;
  amountCents: number;
  currency: string;
  counterpartyName: string;
}

export interface Receipt {
  id: number;
  source: 'mail' | 'upload' | 'vault';
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
  direction: 'incoming' | 'outgoing';
  extraction: 'zugferd' | 'xrechnung' | 'text' | 'ocr' | 'manual' | 'none';
  extractionError: string | null;
  status: ReceiptStatus;
  creditNote: boolean;
  directDebit: boolean;
  einvoice: boolean;
  paymentReference: string | null;
  createdAt: string;
  match: MatchedTransaction | null;
  proposals: number;
}

export interface ReceiptDetail extends Receipt {
  textExcerpt: string | null;
  details: Record<string, unknown>;
  mailAttachmentId: number | null;
}

export interface Transaction {
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
  status: ReceiptStatus;
  note: string | null;
  receipts: {
    matchId: number;
    receiptId: number;
    method: MatchMethod;
    filename: string;
    issuer: string | null;
    invoiceNumber: string | null;
  }[];
}

export interface BankAccount {
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

export interface BankImport {
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

export interface BankImportResult extends BankImport {
  pending: number;
  skipped: { name: string; reason: string }[];
  matched: number;
}

export interface MatchCandidate {
  transaction: Transaction;
  score: number;
  amount: 'exact' | 'near' | 'skonto' | 'fee' | 'none';
  reference: boolean;
  identity: 'iban' | 'creditor' | 'name' | 'weak-name' | null;
  dateFit: 'primary' | 'extended' | 'outside';
  signals: string[];
}

export interface ReviewItem {
  matchId: number;
  method: MatchMethod;
  score: number | null;
  confidence: number | null;
  receipt: Receipt;
  transaction: Transaction;
  candidates: MatchCandidate[];
}

export interface ReceiptSummary {
  month: string | null;
  transactions: Record<ReceiptStatus, number>;
  receipts: Record<ReceiptStatus, number>;
  proposals: number;
  months: string[];
}

export interface MatchOutcome {
  status: 'confirmed' | 'proposed' | 'none' | 'no_candidates' | 'skipped';
  matchId: number | null;
  transactionId: number | null;
  method: MatchMethod | null;
  decision: { status: string; choice: string | null; confidence: number | null } | null;
}

export interface ReceiptFilter {
  status?: ReceiptStatus;
  month?: string;
  q?: string;
  accountId?: number;
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

const base = (projectKey: string) => `/projects/${encodeURIComponent(projectKey)}/receipts`;

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

const json = (body: unknown) => JSON.stringify(body);

export const getReceiptSummary = (projectKey: string, month?: string) =>
  request<ReceiptSummary>(`${base(projectKey)}/summary${query({ month })}`);

export const listReceipts = (projectKey: string, filter: ReceiptFilter) =>
  request<{ receipts: Receipt[] }>(`${base(projectKey)}${query({ ...filter })}`);

export const getReceipt = (projectKey: string, receiptId: number) =>
  request<ReceiptDetail>(`${base(projectKey)}/${receiptId}`);

export const uploadReceipt = (projectKey: string, file: File) =>
  uploadFile<ReceiptDetail>(base(projectKey), 'POST', file);

export const receiptFromVault = (projectKey: string, path: string) =>
  request<ReceiptDetail>(`${base(projectKey)}/from-vault`, {
    method: 'POST',
    body: json({ path }),
  });

export const updateReceipt = (projectKey: string, receiptId: number, patch: ReceiptPatch) =>
  request<ReceiptDetail>(`${base(projectKey)}/${receiptId}`, {
    method: 'PATCH',
    body: json(patch),
  });

export const deleteReceipt = (projectKey: string, receiptId: number) =>
  request<void>(`${base(projectKey)}/${receiptId}`, { method: 'DELETE' });

export const extractReceipt = (projectKey: string, receiptId: number) =>
  request<ReceiptDetail>(`${base(projectKey)}/${receiptId}/extract`, { method: 'POST' });

export const matchReceipt = (projectKey: string, receiptId: number) =>
  request<{ outcome: MatchOutcome; receipt: Receipt }>(`${base(projectKey)}/${receiptId}/match`, {
    method: 'POST',
  });

export const matchReceiptManually = (
  projectKey: string,
  receiptId: number,
  transactionId: number,
) =>
  request<{ receipt: Receipt }>(`${base(projectKey)}/${receiptId}/match-manual`, {
    method: 'POST',
    body: json({ transactionId }),
  });

export const listReceiptCandidates = (projectKey: string, receiptId: number) =>
  request<{ candidates: MatchCandidate[] }>(`${base(projectKey)}/${receiptId}/candidates`);

export const listReview = (projectKey: string, month?: string) =>
  request<{ items: ReviewItem[] }>(`${base(projectKey)}/review${query({ month })}`);

export const confirmMatch = (projectKey: string, matchId: number) =>
  request<{ receipt: Receipt }>(`${base(projectKey)}/matches/${matchId}/confirm`, {
    method: 'POST',
  });

export const rejectMatch = (projectKey: string, matchId: number) =>
  request<{ receipt: Receipt }>(`${base(projectKey)}/matches/${matchId}/reject`, {
    method: 'POST',
  });

export const removeMatch = (projectKey: string, matchId: number) =>
  request<void>(`${base(projectKey)}/matches/${matchId}`, { method: 'DELETE' });

export const listTransactions = (projectKey: string, filter: ReceiptFilter) =>
  request<{ transactions: Transaction[] }>(
    `${base(projectKey)}/transactions${query({ ...filter })}`,
  );

export const updateTransaction = (
  projectKey: string,
  transactionId: number,
  patch: { status?: 'open' | 'ignored'; note?: string | null },
) =>
  request<Transaction>(`${base(projectKey)}/transactions/${transactionId}`, {
    method: 'PATCH',
    body: json(patch),
  });

export const listBankAccounts = (projectKey: string) =>
  request<{ accounts: BankAccount[] }>(`${base(projectKey)}/accounts`);

export const createBankAccount = (
  projectKey: string,
  body: { name: string; iban?: string | null; currency?: string },
) => request<BankAccount>(`${base(projectKey)}/accounts`, { method: 'POST', body: json(body) });

export const updateBankAccount = (
  projectKey: string,
  accountId: number,
  body: { name?: string; iban?: string | null; currency?: string },
) =>
  request<BankAccount>(`${base(projectKey)}/accounts/${accountId}`, {
    method: 'PATCH',
    body: json(body),
  });

export const deleteBankAccount = (projectKey: string, accountId: number) =>
  request<void>(`${base(projectKey)}/accounts/${accountId}`, { method: 'DELETE' });

export const importStatement = (projectKey: string, accountId: number, file: File) =>
  uploadFile<BankImportResult>(`${base(projectKey)}/accounts/${accountId}/imports`, 'POST', file);

export const listImports = (projectKey: string, accountId?: number) =>
  request<{ imports: BankImport[] }>(`${base(projectKey)}/imports${query({ accountId })}`);

// A file of the API as a blob, with the session: the export ZIP and a receipt's file, which
// the browser saves or opens from an object URL.
async function blobOf(path: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw await apiFailure(res);
  return res.blob();
}

export const downloadMonthExport = (projectKey: string, month: string) =>
  blobOf(`${base(projectKey)}/export${query({ month })}`);

export const receiptFileBlob = (projectKey: string, receiptId: number) =>
  blobOf(`${base(projectKey)}/${receiptId}/file`);
