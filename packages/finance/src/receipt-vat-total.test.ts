import { describe, expect, test } from 'bun:test';
import { factsFromText } from './receipt-text';

describe('VAT-inclusive totals are not VAT amounts', () => {
  test('does not invent column associations in a flattened invoice table', () => {
    const text = `Example Services Ltd
Invoice Number: TEST-900
Unit price excluding tax
Unit price including tax
Line total excluding VAT
VAT amount
VAT rate
Line total including VAT
Example service 4 25.00 30.00 100.00 20.00 20% 120.00
Total excluding tax 100.00 EUR
Total VAT incl. 120.00 EUR`;
    expect(factsFromText(text)).toMatchObject({
      grossCents: 12000,
      vatCents: null,
      currency: 'EUR',
    });
  });

  test.each([
    'Total VAT incl. 120.00 EUR',
    'Total incl. VAT 120.00 EUR',
    'Total including tax 120.00 EUR',
    'Gesamt inkl. MwSt 120,00 EUR',
    'Summe brutto inkl. Umsatzsteuer 120,00 EUR',
    'Total VAT excl. 100.00 EUR',
    'Total excluding VAT 100.00 EUR',
    'Total incl. VAT 0.00 EUR',
    'Total VAT incl. -120.00 EUR',
  ])('does not return a gross or net total as the tax: %s', (line) => {
    expect(factsFromText(line).vatCents).toBeNull();
  });

  test.each([
    ['VAT 20% 20.00 EUR\nTotal VAT incl. 120.00 EUR', 2000],
    ['Total VAT incl. 120.00 EUR\nVAT 20.00 EUR', 2000],
    ['Total VAT 20.00 EUR\nGrand total 120.00 EUR', 2000],
    ['Total VAT 0.00 EUR\nTotal incl. VAT 100.00 EUR', 0],
    ['Total excl. VAT 100.00 EUR\nVAT 20.00 EUR\nTotal incl. VAT 120.00 EUR', 2000],
    ['Gesamtbetrag 120,00 EUR\nenthaltene MwSt 20% 20,00 EUR', 2000],
    ['Net VAT Gross\nVAT 20% 100.00 20.00 120.00\nTotal incl. VAT 120.00 EUR', 2000],
    ['A= 20% 100.00 20.00 120.00\nTotal incl. VAT 120.00 EUR', 2000],
    ['VAT 20% 20.00 EUR\nVAT 10% 5.00 EUR\nTotal incl. VAT 175.00 EUR', 2500],
  ])('preserves separately identified VAT: %s', (text, vatCents) => {
    expect(factsFromText(text).vatCents).toBe(vatCents);
  });
});
