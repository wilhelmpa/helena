import { expect, it } from 'bun:test';
import { assertReviewedMailSource, type ReviewedMailSource } from '../mail-review';

const source: ReviewedMailSource = {
  accountId: 4,
  threadId: 7207,
  originals: [{ attachmentId: 17, sha256: 'a'.repeat(64), size: 12 }],
};

it('accepts only the reviewed source and exact original inventory', () => {
  expect(() => assertReviewedMailSource(source, structuredClone(source))).not.toThrow();
  for (const changed of [
    { ...source, accountId: 5 },
    { ...source, threadId: 7206 },
    { ...source, originals: [] },
    { ...source, originals: [...source.originals, ...source.originals] },
    ...[{ attachmentId: 18 }, { attachmentId: null }, { sha256: 'b'.repeat(64) }, { size: 13 }].map(
      (change) => ({ ...source, originals: [{ ...source.originals[0]!, ...change }] }),
    ),
  ])
    expect(() => assertReviewedMailSource(source, changed)).toThrow('changed since review');
});

it('ignores original ordering and mutable extraction and receipt status fields', () => {
  const original = { attachmentId: 18, sha256: 'b'.repeat(64), size: 20 };
  const expected = { ...source, originals: [...source.originals, original] };
  const actual = {
    ...source,
    originals: [original, { ...source.originals[0]!, existingId: 100, status: 'existing' }],
  };
  expect(() => assertReviewedMailSource(expected, actual)).not.toThrow();
  expect(expected.originals[0]?.attachmentId).toBe(17);
  expect(actual.originals[0]?.attachmentId).toBe(18);
});
