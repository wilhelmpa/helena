import {
  db,
  helenaReceipt,
  helenaReceiptMatch,
  helenaReceiptOriginalLink,
  helenaReceiptPairHistory,
  helenaReceiptPairSuggestion,
} from '@repo/db';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A supplementary original is never an additional economic amount. */
export const economicReceipt = sql`NOT EXISTS (
  SELECT 1 FROM ${helenaReceiptOriginalLink}
  WHERE ${helenaReceiptOriginalLink.receiptId} = ${helenaReceipt.id}
)`;

export async function lockReceiptProject(tx: Tx, projectId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(748220, ${projectId})`);
}

export async function assertEconomicReceipt(tx: Tx, projectId: number, receiptId: number) {
  await lockReceiptProject(tx, projectId);
  const [link] = await tx
    .select()
    .from(helenaReceiptOriginalLink)
    .where(eq(helenaReceiptOriginalLink.receiptId, receiptId));
  if (link)
    throw new HttpError(
      409,
      'This original belongs to another receipt. Match the primary receipt.',
    );
}

/** Shared admission with matching and intake; no original/fact/match row is changed. */
export async function linkReceiptOriginal(
  projectId: number,
  receiptId: number,
  primaryReceiptId: number,
  userId: string,
) {
  return db.transaction((tx) =>
    linkReceiptOriginalInTransaction(tx, projectId, receiptId, primaryReceiptId, userId),
  );
}

/** Same constraints for an explicit link and a proven fresh intake pair. */
export async function linkReceiptOriginalInTransaction(
  tx: Tx,
  projectId: number,
  receiptId: number,
  primaryReceiptId: number,
  userId: string | null,
) {
  if (receiptId === primaryReceiptId)
    throw new HttpError(409, 'A receipt cannot supplement itself.');
  await lockReceiptProject(tx, projectId);
  const rows = await tx
    .select()
    .from(helenaReceipt)
    .where(
      and(
        eq(helenaReceipt.projectId, projectId),
        inArray(helenaReceipt.id, [receiptId, primaryReceiptId]),
      ),
    )
    .orderBy(helenaReceipt.id)
    .for('update');
  const child = rows.find((r) => r.id === receiptId);
  const primary = rows.find((r) => r.id === primaryReceiptId);
  if (!child || !primary || child.teamId !== primary.teamId)
    throw new HttpError(404, 'Receipt not found');
  const links = await tx
    .select()
    .from(helenaReceiptOriginalLink)
    .where(
      or(
        inArray(helenaReceiptOriginalLink.receiptId, [receiptId, primaryReceiptId]),
        eq(helenaReceiptOriginalLink.primaryReceiptId, receiptId),
      ),
    );
  if (links.some((l) => l.receiptId === primaryReceiptId || l.primaryReceiptId === receiptId))
    throw new HttpError(409, 'Receipt groups cannot be nested.');
  const existing = links.find((l) => l.receiptId === receiptId);
  if (existing) {
    if (existing.primaryReceiptId === primaryReceiptId) return;
    throw new HttpError(409, 'Detach this original before assigning it elsewhere.');
  }
  const matches = await tx
    .select({ id: helenaReceiptMatch.id })
    .from(helenaReceiptMatch)
    .where(
      and(
        eq(helenaReceiptMatch.receiptId, receiptId),
        inArray(helenaReceiptMatch.status, ['confirmed', 'proposed']),
      ),
    );
  if (child.status !== 'open' || matches.length)
    throw new HttpError(409, 'Only an open original without active matches can be attached.');
  if (primary.status === 'ignored') throw new HttpError(409, 'The primary receipt is ignored.');
  await tx.insert(helenaReceiptOriginalLink).values({
    receiptId,
    primaryReceiptId,
    projectId,
    teamId: child.teamId,
    createdByUserId: userId,
  });
  await tx
    .update(helenaReceiptPairSuggestion)
    .set({ status: 'ignored' })
    .where(
      and(
        eq(helenaReceiptPairSuggestion.projectId, projectId),
        eq(helenaReceiptPairSuggestion.status, 'pending'),
        or(
          inArray(helenaReceiptPairSuggestion.receiptId, [receiptId, primaryReceiptId]),
          inArray(helenaReceiptPairSuggestion.candidateId, [receiptId, primaryReceiptId]),
        ),
      ),
    );
}

export async function unlinkReceiptOriginal(
  projectId: number,
  receiptId: number,
  primaryReceiptId: number,
  userId: string | null = null,
) {
  await db.transaction(async (tx) => {
    await lockReceiptProject(tx, projectId);
    // Exact parent binding prevents a stale browser from undoing a later reassignment.
    const [link] = await tx
      .select()
      .from(helenaReceiptOriginalLink)
      .where(
        and(
          eq(helenaReceiptOriginalLink.projectId, projectId),
          eq(helenaReceiptOriginalLink.receiptId, receiptId),
        ),
      );
    if (!link || link.primaryReceiptId !== primaryReceiptId)
      throw new HttpError(409, 'The original assignment has changed.');
    await tx
      .delete(helenaReceiptOriginalLink)
      .where(
        and(
          eq(helenaReceiptOriginalLink.projectId, projectId),
          eq(helenaReceiptOriginalLink.receiptId, receiptId),
          eq(helenaReceiptOriginalLink.primaryReceiptId, primaryReceiptId),
        ),
      );
    await tx.insert(helenaReceiptPairHistory).values({
      projectId,
      teamId: link.teamId,
      receiptId,
      primaryReceiptId,
      action: 'unlink',
      createdByUserId: userId,
    });
  });
}

export async function assertUngroupedReceipt(tx: Tx, projectId: number, receiptId: number) {
  await lockReceiptProject(tx, projectId);
  const [link] = await tx
    .select()
    .from(helenaReceiptOriginalLink)
    .where(
      or(
        eq(helenaReceiptOriginalLink.receiptId, receiptId),
        eq(helenaReceiptOriginalLink.primaryReceiptId, receiptId),
      ),
    );
  if (link)
    throw new HttpError(
      409,
      'Detach supplementary originals before deleting or ignoring a grouped receipt.',
    );
}
