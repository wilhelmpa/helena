import { describe, expect, test } from 'bun:test';
import { factsFromText } from './receipt-text';

const summary = (tax: string) => `Example Platform Inc.
Invoice Number: TEST-420
Invoice date: 2026-02-01
Subtotal                                      $100.00
Total excluding tax                           $100.00
${tax}
Total                                         $120.00
Amount due                                    $120.00 USD`;

describe('VAT with a labelled taxable base and a wrapped printed amount', () => {
  test.each(['0.87', '0.92'])(
    'uses the printed tax above its label, not the base or EUR conversion %s',
    (exchange) => {
      expect(
        factsFromText(
          summary(`                                              $20.00
VAT - Example region (20% on $100.00)
                                              (€${exchange})`),
        ),
      ).toMatchObject({
        grossCents: 12000,
        vatCents: 2000,
        currency: 'USD',
      });
    },
  );

  test.each([
    '$20.00\nVAT - Example region (20% on $100.00)',
    'VAT - Example region (20% on $100.00)\n$20.00',
    'VAT - Example region (20% on $100.00) $20.00',
    'VAT (20% on USD 100.00) USD 20.00',
    'MwSt (20% auf 100,00 EUR) 20,00 EUR',
    'VAT (20% on GBP 100.00) GBP 20.00',
    'VAT (20% on CHF 100.00) CHF 20.00',
    'VAT (20% on -$100.00) -$20.00',
  ])('reads a matching printed amount: %s', (tax) => {
    expect(factsFromText(tax).vatCents).toBe(2000);
  });

  test.each([
    'VAT - Example region (20% on $100.00)',
    'VAT - Example region (20% on $100.00)\n(€18.00)',
    'VAT - Example region (20% on $100.00)\n€20.00',
    '$100.00\nVAT - Example region (20% on $100.00)',
    '$21.00\nVAT - Example region (20% on $100.00)',
    '$20.00\nVAT - Example region (20% on $100.00)\n$21.00',
    'Other charge $20.00\nVAT - Example region (20% on $100.00)',
    '$20.00\nVAT - Example region (20% on C$100.00)',
    'VAT - Example region (20% on $100.00) $30.00',
    'VAT $30.00 (20% on $100.00)\n$20.00',
    'VAT 10% (20% on $100.00)\n$20.00',
  ])('leaves an absent, mismatched or ambiguous tax amount missing: %s', (tax) => {
    expect(factsFromText(tax).vatCents).toBeNull();
  });

  test('preserves separately printed zero, multiple rates and duplicated summary lines', () => {
    expect(factsFromText('VAT (0% on EUR 100.00) EUR 0.00').vatCents).toBe(0);
    expect(
      factsFromText(
        'VAT (20% on USD 100.00) USD 20.00\nVAT (10% on USD 50.00) USD 5.00\nVAT (20% on USD 100.00) USD 20.00',
      ).vatCents,
    ).toBe(2500);
  });

  test('does not derive zero from a detached tax-table rate', () => {
    expect(
      factsFromText(
        'Description Qty Unit price Tax Amount\nExample service 1 EUR 100.00 0% EUR 100.00\nTotal EUR 100.00',
      ).vatCents,
    ).toBeNull();
  });
});
