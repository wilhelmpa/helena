import { expect, it } from 'bun:test';
import { EMPTY_RECEIPT_NOTE, FAILED_RECEIPT_NOTE, recordReceiptAttempt } from '../receipt-retry';

const empty = { kind: 'receipt', projectId: 1, receiptIds: [], note: EMPTY_RECEIPT_NOTE };

it('retains one empty action and preserves unrelated owner and task history', () => {
  const owner = { kind: 'category', note: 'Owner corrected priority' };
  const task = { kind: 'task', issueId: 22 };
  const before = [owner, task, empty];
  const first = recordReceiptAttempt(before, { ...empty, attemptedAt: '2026-09-27T10:00:00.000Z' });
  const second = recordReceiptAttempt(first, { ...empty, attemptedAt: '2026-09-27T11:00:00.000Z' });
  expect(second).toEqual([owner, task, { ...empty, attemptedAt: '2026-09-27T11:00:00.000Z' }]);
  expect(before).toEqual([owner, task, empty]);
});

it('retains a later successful action and the original unsuccessful attempt', () => {
  const completed = { kind: 'receipt', projectId: 1, receiptIds: [88], note: null };
  expect(recordReceiptAttempt([empty], completed)).toEqual([empty, completed]);
});

it('updates only the matching project retry note', () => {
  const failed = { kind: 'skipped', projectId: 1, note: FAILED_RECEIPT_NOTE };
  const other = { ...failed, projectId: 2 };
  const unrelated = { kind: 'skipped', note: 'Task creation failed' };
  const attempt = { ...failed, attemptedAt: '2026-09-27T11:00:00.000Z' };
  expect(recordReceiptAttempt([empty, failed, other, unrelated], attempt)).toEqual([
    empty,
    attempt,
    other,
    unrelated,
  ]);
});
