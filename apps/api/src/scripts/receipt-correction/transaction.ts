import { db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { centsToNumeric } from '#modules/receipts/amounts';
import {
  checkBinding,
  digest,
  requireCorrection,
  type Binding,
  type Correction,
  type Manifest,
} from './review';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Review = {
  version: 1;
  mode: 'dry-run';
  release: string;
  manifestSha256: string;
  entries: Binding[];
};

// The caller validates the manifest/review and supplies the native source and release guards.
// Keeping this transaction boundary separate allows a real PostgreSQL rollback regression.
export async function runCorrectionTransaction(
  database: Pick<typeof db, 'transaction'>,
  manifest: Manifest,
  expected: Review | undefined,
  prepare: (tx: Tx, entry: Correction, apply: boolean) => Promise<Binding>,
  releaseGuard: (release: string) => Promise<void>,
): Promise<Review | { mode: 'apply'; receiptIds: number[] }> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    if (!expected) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const entries: Binding[] = [];
    for (const entry of [...manifest.corrections].sort((a, b) => a.receiptId - b.receiptId)) {
      const current = await prepare(tx, entry, !!expected);
      if (expected) {
        const matches = expected.entries.filter((item) => item.receiptId === entry.receiptId);
        requireCorrection(matches.length === 1);
        checkBinding(matches[0]!, current);
      }
      entries.push(current);
    }
    await releaseGuard(manifest.release);
    if (!expected)
      return {
        version: 1,
        mode: 'dry-run',
        release: manifest.release,
        manifestSha256: digest(manifest),
        entries,
      };
    for (const entry of manifest.corrections) {
      const changes = entry.changes;
      const assignments = [];
      if (changes.issuer !== undefined) assignments.push(sql`issuer = ${changes.issuer}`);
      if (changes.totalGrossCents !== undefined)
        assignments.push(sql`total_gross = ${centsToNumeric(changes.totalGrossCents!)}`);
      if (changes.vatCents !== undefined)
        assignments.push(sql`vat_amount = ${centsToNumeric(changes.vatCents!)}`);
      if (changes.currency !== undefined) assignments.push(sql`currency = ${changes.currency}`);
      const result = await tx.execute(
        sql`UPDATE helena_receipt SET ${sql.join(assignments, sql`, `)} WHERE id = ${entry.receiptId} RETURNING id`,
      );
      requireCorrection(result.length === 1);
    }
    return { mode: 'apply', receiptIds: entries.map((entry) => entry.receiptId) };
  });
}
