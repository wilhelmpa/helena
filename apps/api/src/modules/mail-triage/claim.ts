import { randomUUID } from 'node:crypto';
import { db, helenaMailTriageClaim, withSettledTransactionCallbacks } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { triageRuntime } from './runtime';

export function checkTriageCancellation(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new HttpError(
      409,
      'Mail triage stopped between messages; completed mail remains committed.',
      'mail_triage_cancelled',
    );
}

export async function withProjectTriageClaim<T>(
  projectId: number,
  work: () => Promise<T>,
): Promise<T> {
  const runToken = randomUUID();
  const runtime = triageRuntime();
  // Autocommit acquisition holds no pool connection during work. An uncertain
  // response deliberately leaves any committed claim for verified Root recovery.
  const [claim] = await db
    .insert(helenaMailTriageClaim)
    .values({ projectId, runToken, runtime })
    .onConflictDoNothing()
    .returning();
  if (!claim) {
    const [existing] = await db
      .select({ startedAt: helenaMailTriageClaim.startedAt })
      .from(helenaMailTriageClaim)
      .where(eq(helenaMailTriageClaim.projectId, projectId));
    throw new HttpError(
      409,
      `Mail triage is running or requires Root recovery for this project${existing ? ` (since ${existing.startedAt.toISOString()})` : ''}. A stale claim is never taken over automatically.`,
      'mail_triage_claimed',
    );
  }
  let uncertain = false;
  const result = await withSettledTransactionCallbacks(work, (value) => {
    uncertain = value;
  }).then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  // Only after the actual callback and scoped driver lifetimes have ended. A
  // transport loss still cannot establish backend completion: retain ownership.
  if (uncertain)
    throw new HttpError(
      409,
      'Mail triage has an uncertain database outcome; its claim is retained for Root recovery.',
      'mail_triage_claim_uncertain',
    );
  const released = await db
    .delete(helenaMailTriageClaim)
    .where(
      and(
        eq(helenaMailTriageClaim.projectId, projectId),
        eq(helenaMailTriageClaim.runToken, runToken),
      ),
    )
    .returning({ projectId: helenaMailTriageClaim.projectId });
  if (released.length !== 1)
    throw new HttpError(
      409,
      'Mail triage finished but its claim changed; Root recovery is required.',
      'mail_triage_claim_changed',
    );
  if (!result.ok) throw result.error;
  return result.value;
}
