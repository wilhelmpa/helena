import { describe, expect, test } from 'bun:test';

import {
  addDays,
  daysBetween,
  findIbans,
  formatAmountDe,
  normalizeIban,
  parseAmountCents,
  parseDateAny,
} from './money';

describe('parseAmountCents', () => {
  test.each([
    ['1.234,56', 123456],
    ['-1143,41', -114341],
    ['9,90-', -990],
    ['200', 20000],
    ['-62,3', -6230],
    ['1,234.56', 123456],
    ['€ 12,00', 1200],
    ['12,00 EUR', 1200],
    ['+12,00', 1200],
    ['-119,00 €', -11900],
    ['(49,95)', -4995],
    ['12,-', 1200],
    ['1.234', 123400],
    ['1,234', 123400],
    ['12.5', 1250],
    ['0,125', 13],
    ['1234.5600', 123456],
    ['\u2212 5,00', -500],
    ['1.234.567,89', 123456789],
  ])('%s -> %d', (text, cents) => {
    expect(parseAmountCents(text)).toBe(cents);
  });

  test('explicit styles', () => {
    expect(parseAmountCents('1.234', 'de')).toBe(123400);
    expect(parseAmountCents('1.234', 'en')).toBe(123);
    expect(parseAmountCents('12.50', 'de')).toBe(1250);
    expect(parseAmountCents('1,5', 'en')).toBe(150);
    expect(parseAmountCents('1.234,56', 'en')).toBeNull();
  });

  test.each(['', '+', 'abc', '1,2,3,4,5', '-12-', '12,', 'EUR'])('rejects %p', (text) => {
    expect(parseAmountCents(text)).toBeNull();
  });
});

describe('formatAmountDe', () => {
  test.each([
    [123456, '1.234,56'],
    [-4995, '-49,95'],
    [0, '0,00'],
    [5, '0,05'],
    [123456789, '1.234.567,89'],
  ])('%d -> %s', (cents, text) => {
    expect(formatAmountDe(cents)).toBe(text);
  });
});

describe('IBAN', () => {
  test('normalizes and validates', () => {
    expect(normalizeIban('de89 3704 0044 0532 0130 00')).toBe('DE89370400440532013000');
    expect(normalizeIban('IBAN: DE89370400440532013000')).toBe('DE89370400440532013000');
    expect(normalizeIban('NL91ABNA0417164300')).toBe('NL91ABNA0417164300');
    expect(normalizeIban('DE89370400440532013001')).toBeNull();
    expect(normalizeIban('DE8937040044053201300')).toBeNull();
    expect(normalizeIban('12345')).toBeNull();
  });

  test('finds grouped IBANs in text without swallowing the BIC', () => {
    const text =
      'Bank: IBAN DE42 5001 0517 5407 3243 85 BIC MUSTDEFFXXX, alt: GB29NWBK60161331926819. Kd DE12';
    expect(findIbans(text)).toEqual(['DE42500105175407324385', 'GB29NWBK60161331926819']);
  });
});

describe('parseDateAny', () => {
  test.each([
    ['24.09.26', '2026-09-24'],
    ['24.09.2026', '2026-09-24'],
    ['1.9.2026', '2026-09-01'],
    ['2026-09-24', '2026-09-24'],
    ['2026-09-24T10:15:00+02:00', '2026-09-24'],
    ['09/24/2026', '2026-09-24'],
    ['20260924', '2026-09-24'],
    ['24.09.2026 18:42', '2026-09-24'],
    ['24. September 2026', '2026-09-24'],
    ['3. März 2026', '2026-03-03'],
    ['Sep 24, 2026', '2026-09-24'],
  ])('%s -> %s', (text, iso) => {
    expect(parseDateAny(text)).toBe(iso);
  });

  test('order decides ambiguous dates, impossible orders swap', () => {
    expect(parseDateAny('03/04/2026')).toBe('2026-03-04');
    expect(parseDateAny('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(parseDateAny('24/09/2026')).toBe('2026-09-24');
    expect(parseDateAny('03.04.2026', 'mdy')).toBe('2026-03-04');
  });

  test.each(['31.02.2026', '2026-13-01', 'Kontostand', '', '20261301'])('rejects %p', (text) => {
    expect(parseDateAny(text)).toBeNull();
  });

  test('day arithmetic', () => {
    expect(addDays('2026-09-01', 30)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-09-01', '2026-10-01')).toBe(30);
    expect(daysBetween('2026-10-01', '2026-09-01')).toBe(-30);
  });
});
