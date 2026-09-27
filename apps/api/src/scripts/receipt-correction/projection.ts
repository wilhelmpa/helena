import { sql } from 'drizzle-orm';
import { numericToCents } from '#modules/receipts/amounts';
import { requireCorrection, type Facts } from './review';

// Keep the full JSONB row for CAS, but read money separately as exact decimal text.
// JSONB decoding turns non-null numeric columns into JavaScript numbers.
export const receiptProjection = sql`
  to_jsonb(r) AS receipt, r.xmin::text AS revision,
  r.total_gross::text AS total_gross_text, r.vat_amount::text AS vat_amount_text`;

export function factsFromProjection(projection: Record<string, unknown>): Facts {
  const row = projection.receipt as Record<string, unknown>;
  requireCorrection(row && typeof row === 'object' && !Array.isArray(row));
  requireCorrection(row.issuer === null || typeof row.issuer === 'string');
  requireCorrection(typeof row.currency === 'string');
  const gross = projection.total_gross_text;
  const vat = projection.vat_amount_text;
  requireCorrection(gross === null || typeof gross === 'string');
  requireCorrection(vat === null || typeof vat === 'string');
  return {
    issuer: row.issuer,
    totalGrossCents: numericToCents(gross),
    vatCents: numericToCents(vat),
    currency: row.currency,
  };
}
