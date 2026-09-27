import { describe, expect, test } from 'bun:test';
import { factsFromProjection } from './projection';
import { digest } from './review';

const row = { issuer: 'Synthetic issuer', currency: 'EUR', total_gross: 24.3, vat_amount: 0 };
const projected = () => ({ receipt: row, total_gross_text: '24.30', vat_amount_text: '0.00' });

describe('receipt facts from exact SQL money projection', () => {
  test('uses decimal text and leaves the complete JSONB digest unchanged', () => {
    const before = digest(row);
    expect(factsFromProjection(projected())).toEqual({
      issuer: 'Synthetic issuer',
      currency: 'EUR',
      totalGrossCents: 2430,
      vatCents: 0,
    });
    expect(digest(row)).toBe(before);
    expect(
      factsFromProjection({ ...projected(), total_gross_text: null, vat_amount_text: null }),
    ).toMatchObject({ totalGrossCents: null, vatCents: null });
    expect(
      factsFromProjection({
        ...projected(),
        total_gross_text: '999999999999.99',
        vat_amount_text: '-0.01',
      }),
    ).toMatchObject({ totalGrossCents: 99999999999999, vatCents: -1 });
  });

  test('refuses missing/numeric money projections and invalid issuer/currency runtime types', () => {
    for (const changed of [
      { total_gross_text: 24.3 },
      { vat_amount_text: 0 },
      { total_gross_text: undefined },
      { vat_amount_text: undefined },
      { receipt: { ...row, issuer: 123 } },
      { receipt: { ...row, currency: null } },
    ])
      expect(() => factsFromProjection({ ...projected(), ...changed })).toThrow('guard failed');
  });
});
