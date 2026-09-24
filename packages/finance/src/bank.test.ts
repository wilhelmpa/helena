import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';

import { dedupeEntries, dedupeKey, isPending, parseBankFile } from './bank';
import type { BankEntry } from './types';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url));

const CSV = 'Buchungstag;Betrag;Name;Verwendungszweck\n01.09.2026;-10,00;Kiosk;Kaffee\n';

describe('parseBankFile', () => {
  test('ZIP with two camt files, a CSV, and files that are skipped', () => {
    const zip = zipSync({
      'statements/2026-08.xml': new Uint8Array(fixture('camt053-v02.xml')),
      'statements/2026-09.xml': new Uint8Array(fixture('camt053-v08.xml')),
      'export.csv': strToU8(CSV),
      'readme.pdf': strToU8('%PDF-1.7'),
      'broken.xml': strToU8('<Document><Nothing/></Document>'),
      '__MACOSX/._2026-08.xml': strToU8('resource fork'),
    });
    const { statements, skipped } = parseBankFile(zip, 'kontoauszuege.zip');
    expect(statements.map((s) => s.format)).toEqual(['csv', 'camt053', 'camt053']);
    expect(statements.map((s) => s.accountIban)).toEqual([
      null,
      'DE89370400440532013000',
      'DE42500105175407324385',
    ]);
    expect(skipped).toEqual([
      { name: 'readme.pdf', reason: 'unsupported file type' },
      { name: 'broken.xml', reason: 'not a camt.052/053/054 document' },
    ]);
  });

  test('guards the entry count', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 502; i++) files[`f${i}.txt`] = strToU8('x');
    const { skipped } = parseBankFile(zipSync(files), 'many.zip');
    expect(skipped).toContainEqual({
      name: '2 more files',
      reason: 'ZIP holds more than 500 files',
    });
    expect(skipped).toHaveLength(501);
  });

  test('guards the declared uncompressed size', () => {
    const zip = zipSync({ 'big.xml': strToU8('<Document/>'), 'small.csv': strToU8(CSV) });
    // Declare 60 MB for the first central directory entry, as a ZIP bomb would.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < zip.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 60 * 1024 * 1024, true);
        break;
      }
    }
    const { statements, skipped } = parseBankFile(zip, 'bomb.zip');
    expect(skipped).toEqual([{ name: 'big.xml', reason: 'ZIP content exceeds 50 MB' }]);
    expect(statements).toHaveLength(1);
  });

  test('unreadable ZIP and plain files', () => {
    expect(parseBankFile(strToU8('PK\u0003\u0004garbage'), 'x.zip').skipped[0]?.reason).toMatch(
      /^unreadable ZIP/,
    );
    const camt = parseBankFile(new Uint8Array(fixture('camt053-v02.xml')), 'auszug.xml');
    expect(camt.statements[0]?.entries).toHaveLength(7);
    const csv = parseBankFile(strToU8(`\uFEFF${CSV}`), 'umsaetze.csv');
    expect(csv.statements[0]?.entries[0]?.amountCents).toBe(-1000);
    expect(parseBankFile(strToU8('hello'), 'x.txt').skipped[0]?.reason).toContain(
      'no bank CSV header',
    );
  });
});

describe('dedupe', () => {
  const entry = (overrides: Partial<BankEntry> = {}): BankEntry => ({
    bookingDate: '2026-09-01',
    valueDate: null,
    amountCents: -350,
    currency: 'EUR',
    counterpartyName: 'Kiosk',
    counterpartyIban: null,
    purpose: 'Kaffee  ',
    endToEndId: null,
    mandateId: null,
    creditorId: null,
    bankReference: null,
    bankCode: null,
    bookingText: null,
    status: 'booked',
    ...overrides,
  });

  test('keys are stable, normalize the purpose and count identical entries', () => {
    const iban = 'DE89370400440532013000';
    const keyed = dedupeEntries(iban, [
      entry(),
      entry({ purpose: 'KAFFEE' }),
      entry({ amountCents: -400 }),
    ]);
    expect(keyed[0]?.dedupeKey).toHaveLength(32);
    expect(keyed[0]?.dedupeKey).toBe(dedupeKey(iban, entry(), 0));
    // Same purpose after normalization: the second is the second occurrence, not a duplicate key.
    expect(keyed[1]?.dedupeKey).toBe(dedupeKey(iban, entry(), 1));
    expect(new Set(keyed.map((k) => k.dedupeKey)).size).toBe(3);
    // Re-importing the same file yields the same keys.
    expect(dedupeEntries(iban, [entry(), entry()]).map((k) => k.dedupeKey)).toEqual([
      keyed[0]?.dedupeKey,
      keyed[1]?.dedupeKey,
    ]);
  });

  test('bank reference and own account are part of the key', () => {
    expect(dedupeKey(null, entry(), 0)).not.toBe(dedupeKey('DE89370400440532013000', entry(), 0));
    expect(dedupeKey(null, entry({ bankReference: 'R1' }), 0)).not.toBe(
      dedupeKey(null, entry(), 0),
    );
  });

  test('isPending', () => {
    expect(isPending(entry({ status: 'pending' }))).toBe(true);
    expect(isPending(entry())).toBe(false);
  });
});
