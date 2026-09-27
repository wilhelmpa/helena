import type { MailClassificationAction } from '@repo/db';

export const EMPTY_RECEIPT_NOTE = 'No supported receipt original found.';
export const FAILED_RECEIPT_NOTE = 'Receipt filing failed; retry on the next triage run.';

export function isReceiptRetryAction(action: MailClassificationAction): boolean {
  return (
    (action.kind === 'receipt' && action.receiptIds?.length === 0) ||
    (action.kind === 'skipped' && action.note === FAILED_RECEIPT_NOTE)
  );
}

export function recordReceiptAttempt(
  actions: MailClassificationAction[],
  action: MailClassificationAction,
): MailClassificationAction[] {
  const index = isReceiptRetryAction(action)
    ? actions.findIndex(
        (prior) =>
          isReceiptRetryAction(prior) &&
          prior.kind === action.kind &&
          prior.projectId === action.projectId &&
          prior.note === action.note,
      )
    : -1;
  if (index === -1) return [...actions, action];
  return actions.map((prior, at) =>
    at === index ? { ...prior, attemptedAt: action.attemptedAt } : prior,
  );
}
