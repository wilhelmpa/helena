import { describe, expect, test } from 'bun:test';
import { factsFromText } from './receipt-text';

describe('currency bound to the invoice or payment total', () => {
  test.each([
    ['Amount due USD 100.00\nVAT USD 10.00\nVAT converted to EUR 9.00', 'USD'],
    ['Amount paid $100.00\nVAT EUR 9.00 (converted)', 'USD'],
    ['Paid: $100.00\nVAT conversion: EUR 9.00', 'USD'],
    ['Total USD 100.00\nTotal excl. tax EUR 90.00\nVAT converted EUR 9.00', 'USD'],
    ['Amount due USD 100.00\nTotal tax EUR 9.00', 'USD'],
    ['Total USD 100.00\nExchange rate: 1 USD = 0.90 EUR', 'USD'],
    ['Amount due USD 100.00\nFooter: prices also available in EUR', 'USD'],
    ['Amount paid $100.00\nRegards, EUR Example Team', 'USD'],
    ['Total CHF 100.00\nVAT converted to EUR 9.00', 'CHF'],
    ['Grand total £100.00\nVAT converted to EUR 9.00', 'GBP'],
    ['Total GBP 100.00\nVAT converted to USD 10.00', 'GBP'],
    ['Amount due\nUSD 100.00\nVAT converted to EUR 9.00', 'USD'],
    ['Amount paid\n$100.00\nVAT converted to EUR 9.00', 'USD'],
    ['Amount due USD 0.00\nVAT converted to EUR 0.00', 'USD'],
    ['Credit note\nGrand total USD -100.00\nVAT converted to EUR -9.00', 'USD'],
    ['Total incl. VAT USD 100.00\nVAT converted to EUR 9.00', 'USD'],
    ['Total VAT incl. USD 100.00\nVAT converted to EUR 9.00', 'USD'],
    ['Total tax included USD 100.00\nVAT converted to EUR 9.00', 'USD'],
    ['Grand total US$100.00\nVAT converted to EUR 9.00', 'USD'],
    ['Grand total USD $100.00\nVAT converted to EUR 9.00', 'USD'],
    ['Total USD 100.00; VAT converted to EUR 9.00', 'USD'],
    ['Prix TTC 100 euros dont 9 euros de TVA\nFooter USD', 'EUR'],
    ['Total TTC : 100,00 EUR\nFooter USD', 'EUR'],
    ['Invoice currency: USD\nAmount due 100.00\nVAT converted to EUR 9.00', 'USD'],
    ['Total USD 100.00\nAmount paid USD 100.00', 'USD'],
  ])('recognizes labelled currency without conversion/footer override: %s', (text, currency) => {
    expect(factsFromText(text).currency).toBe(currency);
  });

  test.each([
    'Amount due USD 100.00\nTotal EUR 90.00',
    'Amount paid $100.00\nAmount due GBP 80.00',
    'Total USD 100.00 / EUR 90.00',
    'Total USD 100.00\nTotal VAT incl. EUR 120.00',
    'Total USD 100.00\nTotal tax included EUR 120.00',
    'Grand total C$ 100.00',
    'Grand total A$100.00',
    'Grand total CA$100.00\nVAT EUR 9.00',
    'Grand total AU$100.00\nInvoice currency: USD',
    'Grand total CAD $100.00\nVAT EUR 9.00',
    'Receipt C$100.00\nVAT EUR 9.00',
    'Invoice currency: CHF\nTotal GBP 100.00',
    'Total 100.00\nWe accept EUR and USD',
    'Total 100.00\nVAT converted to EUR 9.00',
    'Amount due 100.00',
    'Total excl. tax USD 90.00\nVAT converted to EUR 9.00\nFooter GBP',
  ])('leaves conflicting or unbound currencies unresolved: %s', (text) => {
    expect(factsFromText(text).currency).toBeNull();
  });

  test.each([
    ['Rechnung\nGesamtbetrag 119,00 EUR', 'EUR'],
    ['Invoice\nTotal due USD 119.00', 'USD'],
    ['Receipt\nCHF 100.00', 'CHF'],
    ['Receipt\n£100.00', 'GBP'],
    ['Montant total TTC : 100,00 EUR dont 9,00 EUR de TVA', 'EUR'],
  ])('preserves existing single-currency cases: %s', (text, currency) => {
    expect(factsFromText(text).currency).toBe(currency);
  });

  test('keeps unrelated extracted amounts and fields unchanged', () => {
    const before = factsFromText(
      'Example Ltd\nInvoice No: SYN-100\nAmount due USD 100.00\nVAT USD 10.00',
    );
    const after = factsFromText(
      'Example Ltd\nInvoice No: SYN-100\nAmount due USD 100.00\nVAT USD 10.00\nVAT converted to EUR 9.00',
    );
    expect(after).toEqual(before);
  });
});
