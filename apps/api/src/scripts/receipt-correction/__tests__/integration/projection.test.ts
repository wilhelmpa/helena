import { expect, test } from 'bun:test';
import { db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { factsFromProjection, receiptProjection } from '../../projection';
import { digest } from '../../review';

test('real PostgreSQL numeric JSONB uses separate exact text projections for receipt facts', async () => {
  const databaseName = new URL(process.env.DATABASE_URL ?? '').pathname;
  if (process.env.NODE_ENV !== 'test' || !databaseName.includes('test'))
    throw new Error('Private test database required');
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE TEMP TABLE receipt_money_projection (
        id integer PRIMARY KEY, issuer text, currency text,
        total_gross numeric(14,2), vat_amount numeric(14,2)
      ) ON COMMIT DROP`);
    await tx.execute(sql`
      INSERT INTO receipt_money_projection VALUES
        (1, 'Synthetic issuer', 'EUR', 24.30, 0.00),
        (2, NULL, 'EUR', NULL, NULL),
        (3, 'Synthetic maximum', 'EUR', 999999999999.99, -0.01)`);
    // This is the identical SQL projection used by the native prepare query.
    const rows = await tx.execute(sql`
      SELECT ${receiptProjection} FROM receipt_money_projection r ORDER BY r.id`);
    expect(rows).toHaveLength(3);
    const first = rows[0]!;
    expect(first.receipt).toMatchObject({ total_gross: 24.3, vat_amount: 0 });
    expect(first.total_gross_text).toBe('24.30');
    expect(first.vat_amount_text).toBe('0.00');
    const originalDigest = digest(first.receipt);
    expect(factsFromProjection(first)).toEqual({
      issuer: 'Synthetic issuer',
      currency: 'EUR',
      totalGrossCents: 2430,
      vatCents: 0,
    });
    expect(digest(first.receipt)).toBe(originalDigest);
    expect(factsFromProjection(rows[1]!)).toEqual({
      issuer: null,
      currency: 'EUR',
      totalGrossCents: null,
      vatCents: null,
    });
    expect(rows[2]!.total_gross_text).toBe('999999999999.99');
    expect(rows[2]!.vat_amount_text).toBe('-0.01');
    expect(factsFromProjection(rows[2]!)).toMatchObject({
      totalGrossCents: 99999999999999,
      vatCents: -1,
    });
  });
});
