import { describe, expect, test } from 'bun:test';
import {
  canonical,
  checkBinding,
  checkFacts,
  digest,
  parseManifest,
  type Binding,
  type Correction,
  type Manifest,
} from './review';

const before = {
  issuer: 'Synthetic issuer',
  totalGrossCents: null,
  vatCents: null,
  currency: 'EUR',
};
const entry = (receiptId: number): Correction => ({
  receiptId,
  projectId: 20,
  projectKey: 'PRIV',
  teamId: 1,
  messageId: 100 + receiptId,
  threadId: 200 + receiptId,
  attachmentId: null,
  originalSha256: 'a'.repeat(64),
  originalSize: 123,
  before: { ...before },
  changes: { totalGrossCents: 1234, vatCents: 112 },
});
const manifest = (): Manifest => ({
  version: 1,
  release: 'b'.repeat(40),
  corrections: [
    {
      ...entry(6),
      projectId: 21,
      projectKey: 'FAM',
      attachmentId: 300,
      changes: { issuer: 'Synthetic Cloud Limited' },
    },
    ...Array.from({ length: 8 }, (_, index) => entry(46 + index)),
  ],
});
const binding = (): Binding => ({
  receiptId: 46,
  revision: '101',
  rowSha256: 'a'.repeat(64),
  sourceSha256: 'b'.repeat(64),
  originalSha256: 'c'.repeat(64),
  originalSize: 123,
  changes: { totalGrossCents: 1234, vatCents: 112 },
});

describe('reviewed nine-receipt correction', () => {
  test('accepts only the exact receipt scope and bounded fields', () => {
    expect(parseManifest(manifest()).corrections).toHaveLength(9);
    for (const mutate of [
      (m: Manifest) => {
        m.corrections.pop();
      },
      (m: Manifest) => {
        m.corrections[8]!.receiptId = 54;
      },
      (m: Manifest) => {
        m.corrections[8]!.receiptId = 46;
      },
      (m: Manifest) => {
        m.corrections[0]!.attachmentId = 301;
      },
      (m: Manifest) => {
        m.corrections[1]!.projectKey = 'FAM';
      },
      (m: Manifest) => {
        m.corrections[1]!.changes = { issuer: 'Guessed issuer' };
      },
      (m: Manifest) => {
        m.corrections[0]!.changes = { currency: 'USD' };
      },
      (m: Manifest) => {
        Object.assign(m.corrections[1]!.changes, { direction: 'outgoing' });
      },
      (m: Manifest) => {
        m.corrections[1]!.changes.vatCents = null;
      },
      (m: Manifest) => {
        m.corrections[1]!.before.currency = 'USD';
      },
      (m: Manifest) => {
        m.corrections[1]!.changes.totalGrossCents = 12.34;
      },
      (m: Manifest) => {
        m.corrections[1]!.originalSha256 = 'bad';
      },
    ]) {
      const value = manifest();
      mutate(value);
      expect(() => parseManifest(value)).toThrow('guard failed');
    }
  });

  test('requires reviewed old facts and exact parser agreement', () => {
    const correction = entry(46);
    const extracted = { ...before, totalGrossCents: 1234, vatCents: 112 };
    expect(() => checkFacts(correction, before, extracted)).not.toThrow();
    expect(() =>
      checkFacts(correction, { ...before, issuer: 'Owner correction' }, extracted),
    ).toThrow();
    expect(() => checkFacts(correction, before, { ...extracted, vatCents: 113 })).toThrow();
    expect(() => checkFacts(correction, extracted, extracted)).toThrow();
  });

  test('rejects intervening owner edits, ABA writes, original or source changes', () => {
    const old = binding();
    expect(() => checkBinding(old, binding())).not.toThrow();
    for (const change of [
      { rowSha256: 'd'.repeat(64) },
      { revision: '102' },
      { sourceSha256: 'e'.repeat(64) },
      { originalSha256: 'f'.repeat(64) },
      { originalSize: 124 },
      { receiptId: 54 },
      { changes: { totalGrossCents: 1235, vatCents: 112 } },
    ])
      expect(() => checkBinding(old, { ...old, ...change })).toThrow();
  });

  test('canonical binding includes all nested fields without depending on JSON key order', () => {
    expect(canonical({ b: { d: 4, c: 3 }, a: 1 })).toBe(canonical({ a: 1, b: { c: 3, d: 4 } }));
    expect(digest({ issuer: 'Synthetic', details: { creditNote: false } })).not.toBe(
      digest({ issuer: 'Synthetic', details: { creditNote: true } }),
    );
  });
});
