import type { OriginalPairEvidence } from './original-pair';

export interface ReviewedMailSource {
  accountId: number;
  threadId: number;
  originals: { attachmentId: number | null; sha256: string; size: number }[];
  originalPair?: OriginalPairEvidence | null;
}

export function assertReviewedMailSource(expected: ReviewedMailSource, actual: ReviewedMailSource) {
  const inventory = (source: ReviewedMailSource) =>
    JSON.stringify({
      accountId: source.accountId,
      threadId: source.threadId,
      originalPair: source.originalPair ?? null,
      originals: source.originals
        .map(({ attachmentId, sha256, size }) => ({ attachmentId, sha256, size }))
        .sort((a, b) => (a.attachmentId ?? 0) - (b.attachmentId ?? 0)),
    });
  if (inventory(expected) !== inventory(actual))
    throw new Error(
      'Mail originals or source changed since review; run and review a fresh dry-run.',
    );
}
