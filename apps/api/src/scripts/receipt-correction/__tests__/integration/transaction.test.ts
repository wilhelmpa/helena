import { describe, expect, test } from 'bun:test';
import { db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { digest, type Binding, type Correction, type Manifest } from '../../review';
import { runCorrectionTransaction, type Review } from '../../transaction';

const ids = [6, 46, 47, 48, 49, 50, 51, 52, 53];
const manifest: Manifest = {
  version: 1,
  release: 'b'.repeat(40),
  corrections: ids.map((receiptId) => ({
    receiptId,
    projectId: receiptId === 6 ? 21 : 20,
    projectKey: receiptId === 6 ? 'FAM' : 'PRIV',
    teamId: 1,
    messageId: 100 + receiptId,
    threadId: 200 + receiptId,
    attachmentId: receiptId === 6 ? 300 : null,
    originalSha256: 'a'.repeat(64),
    originalSize: 123,
    before: {
      issuer: 'Synthetic old issuer',
      totalGrossCents: null,
      vatCents: null,
      currency: 'EUR',
    },
    changes:
      receiptId === 6
        ? { issuer: 'Synthetic corrected issuer' }
        : { totalGrossCents: 1234, vatCents: 112 },
  })),
};
const binding = (entry: Correction): Binding => ({
  receiptId: entry.receiptId,
  revision: '101',
  rowSha256: 'c'.repeat(64),
  sourceSha256: 'd'.repeat(64),
  originalSha256: entry.originalSha256,
  originalSize: entry.originalSize,
  changes: entry.changes,
});
const review = (): Review => ({
  version: 1,
  mode: 'dry-run',
  release: manifest.release,
  manifestSha256: digest(manifest),
  entries: manifest.corrections.map(binding),
});

// No live paths, files, extraction, provider, or module mocks. Use the real transaction
// runner and SQL writer on a session-local shadow table. The surrounding transaction
// owns the fixture; the runner's real savepoint must undo every earlier statement.
// IDs are deliberately fixed because the one-off operator has that exact scope.
describe('reviewed correction PostgreSQL transaction', () => {
  for (const mode of ['late-failure', 'success', 'stale-last-binding'] as const) {
    test(mode, async () => {
      const databaseName = new URL(process.env.DATABASE_URL ?? '').pathname;
      if (process.env.NODE_ENV !== 'test' || !databaseName.includes('test'))
        throw new Error('Private test database required');
      await db.transaction(async (fixture) => {
        await fixture.execute(sql`
          CREATE TEMP TABLE helena_receipt (
            id integer PRIMARY KEY,
            issuer text,
            total_gross numeric(14,2),
            vat_amount numeric(14,2),
            currency text NOT NULL,
            status text NOT NULL,
            details jsonb NOT NULL
          ) ON COMMIT DROP`);
        for (const id of [...ids, 54])
          await fixture.execute(sql`
            INSERT INTO helena_receipt VALUES (
              ${id}, 'Synthetic old issuer', NULL, NULL, 'EUR', 'open', '{"ownerNote":"keep"}'
            )`);
        const snapshot = () => fixture.execute(sql`SELECT * FROM helena_receipt ORDER BY id`);
        const before = Array.from(await snapshot());
        if (mode === 'late-failure') {
          await fixture.execute(sql`
            CREATE OR REPLACE FUNCTION pg_temp.refuse_ninth_receipt() RETURNS trigger AS $$
            BEGIN
              IF NEW.id = 53 THEN
                IF (SELECT count(*) FROM helena_receipt
                    WHERE issuer = 'Synthetic corrected issuer' OR total_gross = 12.34) <> 8 THEN
                  RAISE EXCEPTION 'fixture did not reach eight prior writes';
                END IF;
                RAISE EXCEPTION 'controlled failure after eight prior writes';
              END IF;
              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql`);
          await fixture.execute(sql`
            CREATE TRIGGER refuse_ninth BEFORE UPDATE ON helena_receipt
            FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_ninth_receipt()`);
        }
        const reviewed = review();
        if (mode === 'stale-last-binding') reviewed.entries[8]!.revision = '102';
        const run = () =>
          runCorrectionTransaction(
            fixture,
            manifest,
            reviewed,
            async (_tx, entry) => binding(entry),
            async () => {},
          );
        if (mode === 'success') {
          expect(await run()).toEqual({ mode: 'apply', receiptIds: ids });
          const after = Array.from(await snapshot());
          expect(after).toEqual(
            before.map((row) =>
              row.id === 6
                ? { ...row, issuer: 'Synthetic corrected issuer' }
                : row.id === 54
                  ? row
                  : { ...row, total_gross: '12.34', vat_amount: '1.12' },
            ),
          );
        } else {
          let failure: unknown;
          try {
            await run();
          } catch (error) {
            failure = error;
          }
          expect(failure).toBeDefined();
          if (mode === 'late-failure') {
            // Drizzle wraps the PostgreSQL error; assert its cause, not merely any failure.
            const cause = (failure as Error & { cause?: Error }).cause ?? failure;
            expect(String(cause)).toContain('controlled failure after eight prior writes');
          }
          expect(Array.from(await snapshot())).toEqual(before);
        }
        if (mode === 'late-failure') {
          await fixture.execute(sql`DROP TRIGGER refuse_ninth ON helena_receipt`);
          await fixture.execute(sql`DROP FUNCTION pg_temp.refuse_ninth_receipt()`);
        }
      });
    });
  }
});
