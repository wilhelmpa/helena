// Receipt matching (Belege): the queries and mutations of the project page. Every mutation
// refreshes the whole receipts cache of the project, since a match changes a receipt, a
// transaction, the review list and the counts at once. Failures are toasted by the app's
// mutation cache.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmMatch,
  setReceiptOriginalLink,
  createBankAccount,
  deleteBankAccount,
  deleteReceipt,
  extractReceipt,
  getReceipt,
  getReceiptSummary,
  importStatement,
  listBankAccounts,
  listImports,
  listReceiptCandidates,
  listReceipts,
  listReview,
  listTransactions,
  matchReceipt,
  matchReceiptManually,
  receiptFromVault,
  rejectMatch,
  removeMatch,
  updateBankAccount,
  updateReceipt,
  updateTransaction,
  uploadReceipt,
  type ReceiptFilter,
  type ReceiptPatch,
  getReceiptDedup,
  setReceiptDedup,
  getReceiptProjection,
  setReceiptProjection,
  rebuildReceiptProjection,
} from '@/lib/api/endpoints/receipts';

const root = (projectKey: string) => ['receipts', projectKey] as const;

const keys = {
  summary: (projectKey: string, month: string | undefined) =>
    [...root(projectKey), 'summary', month ?? 'all'] as const,
  receipts: (projectKey: string, filter: ReceiptFilter) =>
    [...root(projectKey), 'list', filter] as const,
  receipt: (projectKey: string, receiptId: number) =>
    [...root(projectKey), 'receipt', receiptId] as const,
  candidates: (projectKey: string, receiptId: number) =>
    [...root(projectKey), 'candidates', receiptId] as const,
  transactions: (projectKey: string, filter: ReceiptFilter) =>
    [...root(projectKey), 'transactions', filter] as const,
  review: (projectKey: string, month: string | undefined) =>
    [...root(projectKey), 'review', month ?? 'all'] as const,
  accounts: (projectKey: string) => [...root(projectKey), 'accounts'] as const,
  imports: (projectKey: string) => [...root(projectKey), 'imports'] as const,
};

function useRefresh(projectKey: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: root(projectKey) });
}

export function useReceiptSummaryQuery(
  projectKey: string,
  month: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: keys.summary(projectKey, month),
    queryFn: () => getReceiptSummary(projectKey, month),
    enabled,
  });
}

export function useReceiptsQuery(projectKey: string, filter: ReceiptFilter, enabled = true) {
  return useQuery({
    queryKey: keys.receipts(projectKey, filter),
    queryFn: () => listReceipts(projectKey, filter),
    select: (data) => data.receipts,
    enabled,
  });
}

export function useReceiptQuery(projectKey: string, receiptId: number | null) {
  return useQuery({
    queryKey: keys.receipt(projectKey, receiptId ?? 0),
    queryFn: () => getReceipt(projectKey, receiptId!),
    enabled: receiptId !== null,
  });
}

export function useReceiptCandidatesQuery(projectKey: string, receiptId: number | null) {
  return useQuery({
    queryKey: keys.candidates(projectKey, receiptId ?? 0),
    queryFn: () => listReceiptCandidates(projectKey, receiptId!),
    select: (data) => data.candidates,
    enabled: receiptId !== null,
  });
}

export function useTransactionsQuery(projectKey: string, filter: ReceiptFilter, enabled = true) {
  return useQuery({
    queryKey: keys.transactions(projectKey, filter),
    queryFn: () => listTransactions(projectKey, filter),
    select: (data) => data.transactions,
    enabled,
  });
}

export function useReviewQuery(projectKey: string, month: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.review(projectKey, month),
    queryFn: () => listReview(projectKey, month),
    select: (data) => data.items,
    enabled,
  });
}

export function useBankAccountsQuery(projectKey: string, enabled = true) {
  return useQuery({
    queryKey: keys.accounts(projectKey),
    queryFn: () => listBankAccounts(projectKey),
    select: (data) => data.accounts,
    enabled,
  });
}

export function useImportsQuery(projectKey: string, enabled = true) {
  return useQuery({
    queryKey: keys.imports(projectKey),
    queryFn: () => listImports(projectKey),
    select: (data) => data.imports,
    enabled,
  });
}

// Uploads report a duplicate themselves (it is not an error to the person), so the global
// toast is off for this one.
export function useUploadReceipt(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (file: File) => uploadReceipt(projectKey, file),
    onSettled: refresh,
    meta: { suppressErrorToast: true },
  });
}

export function useReceiptFromVault(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (path: string) => receiptFromVault(projectKey, path),
    onSuccess: refresh,
    meta: { suppressErrorToast: true },
  });
}

export function useUpdateReceipt(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: ({ receiptId, patch }: { receiptId: number; patch: ReceiptPatch }) =>
      updateReceipt(projectKey, receiptId, patch),
    onSuccess: refresh,
  });
}

export function useDeleteReceipt(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (receiptId: number) => deleteReceipt(projectKey, receiptId),
    onSuccess: refresh,
  });
}

export function useExtractReceipt(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (receiptId: number) => extractReceipt(projectKey, receiptId),
    onSuccess: refresh,
  });
}

export function useMatchReceipt(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (receiptId: number) => matchReceipt(projectKey, receiptId),
    onSuccess: refresh,
  });
}

export function useMatchManually(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: ({ receiptId, transactionId }: { receiptId: number; transactionId: number }) =>
      matchReceiptManually(projectKey, receiptId, transactionId),
    onSuccess: refresh,
  });
}

export function useConfirmMatch(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (matchId: number) => confirmMatch(projectKey, matchId),
    onSuccess: refresh,
  });
}

export function useRejectMatch(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (matchId: number) => rejectMatch(projectKey, matchId),
    onSuccess: refresh,
  });
}

export function useRemoveMatch(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (matchId: number) => removeMatch(projectKey, matchId),
    onSuccess: refresh,
  });
}

export function useUpdateTransaction(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: ({
      transactionId,
      patch,
    }: {
      transactionId: number;
      patch: { status?: 'open' | 'ignored'; note?: string | null };
    }) => updateTransaction(projectKey, transactionId, patch),
    onSuccess: refresh,
  });
}

export function useCreateBankAccount(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (body: { name: string; iban?: string | null }) =>
      createBankAccount(projectKey, body),
    onSuccess: refresh,
  });
}

export function useUpdateBankAccount(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: ({
      accountId,
      body,
    }: {
      accountId: number;
      body: { name?: string; iban?: string | null };
    }) => updateBankAccount(projectKey, accountId, body),
    onSuccess: refresh,
  });
}

export function useDeleteBankAccount(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: (accountId: number) => deleteBankAccount(projectKey, accountId),
    onSuccess: refresh,
  });
}

export function useImportStatement(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: ({ accountId, file }: { accountId: number; file: File }) =>
      importStatement(projectKey, accountId, file),
    onSuccess: refresh,
  });
}

export function useReceiptOriginalLink(projectKey: string) {
  const refresh = useRefresh(projectKey);
  return useMutation({
    mutationFn: ({
      receiptId,
      primaryReceiptId,
      attach,
    }: {
      receiptId: number;
      primaryReceiptId: number;
      attach: boolean;
    }) => setReceiptOriginalLink(projectKey, receiptId, primaryReceiptId, attach),
    onSuccess: refresh,
  });
}

export function useReceiptDedupQuery(teamId: number | null) {
  return useQuery({
    queryKey: ['receipt-dedup', teamId],
    queryFn: () => getReceiptDedup(teamId!),
    enabled: teamId != null && teamId > 0,
  });
}

export function useSetReceiptDedup(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (autoMerge: boolean) => setReceiptDedup(teamId, autoMerge),
    onSuccess: (data) => qc.setQueryData(['receipt-dedup', teamId], data),
  });
}

// "Belege als Notizen" (a team setting, off by default) and rebuilding a project's notes.
export function useReceiptProjectionQuery(teamId: number | null) {
  return useQuery({
    queryKey: ['receipt-projection', teamId],
    queryFn: () => getReceiptProjection(teamId!),
    enabled: teamId != null && teamId > 0,
  });
}

export function useSetReceiptProjection(teamId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => setReceiptProjection(teamId, enabled),
    onSuccess: (data) => {
      qc.setQueryData(['receipt-projection', teamId], data);
      void qc.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useRebuildReceiptProjection(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rebuildReceiptProjection(projectKey),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['files'] }),
  });
}
