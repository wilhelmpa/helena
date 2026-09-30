import { threadHref } from '#modules/mail/threads/links';

type ClassificationResult = {
  status: string;
  issueId: number | null;
  actions: { kind: string; receiptIds?: number[] }[];
  error?: string | null;
} | null;

export function receiptSummary(ids: number[]) {
  const receiptIds = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  return { receiptIds, receiptCount: receiptIds.length };
}

// Keep the source identity from the project-scoped pending query even if classification fails.
export async function triageMessageResult(
  projectKey: string,
  message: { id: number; threadId: number },
  classify: () => Promise<ClassificationResult>,
) {
  const source = {
    messageId: message.id,
    threadId: message.threadId,
    threadHref: threadHref(projectKey, message.threadId),
  };
  try {
    const result = await classify();
    return {
      ...source,
      ...receiptSummary(
        result?.actions.flatMap((action) =>
          action.kind === 'receipt' ? (action.receiptIds ?? []) : [],
        ) ?? [],
      ),
      status: result?.status ?? 'skipped',
      issueId: result?.issueId ?? null,
      actionFailed: result?.actions.some((action) => action.kind === 'skipped') ?? false,
      ...(result?.error ? { error: result.error } : {}),
    };
  } catch {
    return {
      ...source,
      ...receiptSummary([]),
      status: 'failed',
      issueId: null,
      actionFailed: true,
      error: 'Classification failed before a result was stored.',
    };
  }
}
