import {
  db,
  getSetting,
  helenaReceipt,
  helenaReceiptOriginalLink,
  helenaReceiptPairHistory,
  helenaReceiptPairSuggestion,
  project as projectTable,
  setSetting,
} from '@repo/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { linkReceiptOriginalInTransaction, lockReceiptProject } from './originals';
import { originalDocumentEvidence } from './original-pair';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = typeof helenaReceipt.$inferSelect;
export type PairFinding = {
  receiptId: number;
  candidateId: number;
  primaryReceiptId: number | null;
  kind: 'auto' | 'pair' | 'duplicate';
  reason: string;
};

const settingKey = (teamId: number) => `receipts.auto-merge.team.${teamId}`;
export async function autoMergeEnabled(teamId: number) {
  return (await getSetting<boolean>(settingKey(teamId))) !== false;
}
export async function receiptDedupSetting(teamId: number) {
  return { autoMerge: await autoMergeEnabled(teamId) };
}
export async function setReceiptDedupSetting(teamId: number, autoMerge: boolean) {
  await setSetting(settingKey(teamId), autoMerge);
  return { autoMerge };
}

function day(row: Row) {
  return row.invoiceDate ?? row.createdAt.toISOString().slice(0, 10);
}
function normalized(value: string | null) {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en') || null;
}
function role(row: Row) {
  const evidence = originalDocumentEvidence(row.textExcerpt ?? '');
  const issuer = normalized(row.issuer);
  if (
    !evidence ||
    !row.textExcerpt ||
    row.textExcerpt.length >= 2000 ||
    !issuer ||
    !normalized(row.textExcerpt)?.includes(issuer) ||
    normalized(evidence.invoiceNumber) !== normalized(row.invoiceNumber) ||
    evidence.grossCents !== cents(row.totalGross) ||
    evidence.currency !== row.currency ||
    row.extractionError
  )
    return null;
  return evidence.role;
}
function cents(value: string | null) {
  return value === null ? null : Math.round(Number(value) * 100);
}

export function inspectReceiptPair(a: Row, b: Row): PairFinding | null {
  if (a.projectId !== b.projectId || a.teamId !== b.teamId || a.id === b.id) return null;
  if (a.direction !== b.direction || a.direction !== 'incoming') return null;
  if (Math.abs(Date.parse(day(a)) - Date.parse(day(b))) > 7 * 86_400_000) return null;
  const issuerA = normalized(a.issuer);
  const issuerB = normalized(b.issuer);
  const refA = normalized(a.invoiceNumber);
  const refB = normalized(b.invoiceNumber);
  if (refA && refB && refA !== refB) return null;
  const amountA = cents(a.totalGross);
  const amountB = cents(b.totalGross);
  if (amountA !== null && amountB !== null && a.currency !== b.currency) return null;
  if (amountA !== null && amountB !== null && amountA !== amountB) return null;
  if (issuerA && issuerB && issuerA !== issuerB) return null;
  if (!issuerA && !issuerB && !refA && !refB) return null;
  const receiptId = Math.min(a.id, b.id);
  const candidateId = Math.max(a.id, b.id);
  if (amountA === null || amountB === null) {
    if (!issuerA || issuerA !== issuerB || day(a) !== day(b)) return null;
    return {
      receiptId,
      candidateId,
      primaryReceiptId: null,
      kind: 'duplicate',
      reason: 'Same issuer and day; at least one amount is missing',
    };
  }
  const roleA = role(a);
  const roleB = role(b);
  const complementary = roleA !== null && roleB !== null && roleA !== roleB;
  const invoice = roleA === 'invoice' ? a : roleB === 'invoice' ? b : null;
  const payment = roleA === 'receipt' ? a : roleB === 'receipt' ? b : null;
  const strong =
    complementary &&
    !!refA &&
    refA === refB &&
    !!issuerA &&
    issuerA === issuerB &&
    !!a.invoiceDate &&
    !!b.invoiceDate &&
    invoice?.status !== 'ignored' &&
    payment?.status === 'open';
  if (strong)
    return {
      receiptId,
      candidateId,
      primaryReceiptId: invoice!.id,
      kind: 'auto',
      reason: 'Invoice and paid receipt: issuer, reference, amount, currency and date agree',
    };
  if ((refA && refA === refB) || (issuerA && issuerA === issuerB))
    return {
      receiptId,
      candidateId,
      primaryReceiptId: invoice?.id ?? null,
      kind: 'pair',
      reason: complementary
        ? 'Possible invoice and payment receipt'
        : 'Possible receipt pair; document roles need review',
    };
  return null;
}

export async function inspectNewReceipts(
  tx: Tx,
  projectId: number,
  newIds: number[],
  enabled: boolean,
  userId: string | null = null,
) {
  if (!newIds.length) return [];
  await lockReceiptProject(tx, projectId);
  const rows = await tx
    .select()
    .from(helenaReceipt)
    .where(eq(helenaReceipt.projectId, projectId))
    .orderBy(asc(helenaReceipt.id));
  const links = await tx
    .select()
    .from(helenaReceiptOriginalLink)
    .where(eq(helenaReceiptOriginalLink.projectId, projectId));
  const linked = new Set(links.flatMap((link) => [link.receiptId, link.primaryReceiptId]));
  const history = await tx
    .select()
    .from(helenaReceiptPairHistory)
    .where(
      and(
        eq(helenaReceiptPairHistory.projectId, projectId),
        eq(helenaReceiptPairHistory.action, 'unlink'),
      ),
    );
  const detached = new Set(
    history.map(
      (item) =>
        `${Math.min(item.receiptId, item.primaryReceiptId)}:${Math.max(item.receiptId, item.primaryReceiptId)}`,
    ),
  );
  const resolved = await tx
    .select()
    .from(helenaReceiptPairSuggestion)
    .where(
      and(
        eq(helenaReceiptPairSuggestion.projectId, projectId),
        eq(helenaReceiptPairSuggestion.status, 'ignored'),
      ),
    );
  const ignored = new Set(resolved.map((item) => `${item.receiptId}:${item.candidateId}`));
  const findings: PairFinding[] = [];
  for (const row of rows.filter(
    (item) => newIds.includes(item.id) && !linked.has(item.id) && item.status !== 'ignored',
  )) {
    const candidates = rows.filter(
      (other) => other.id !== row.id && !linked.has(other.id) && other.status !== 'ignored',
    );
    const found = candidates
      .map((other) => inspectReceiptPair(row, other))
      .filter((item): item is PairFinding => !!item)
      .filter(
        (item) =>
          !detached.has(`${item.receiptId}:${item.candidateId}`) &&
          !ignored.has(`${item.receiptId}:${item.candidateId}`),
      );
    const autos = found.filter((item) => item.kind === 'auto');
    for (const finding of found) {
      if (
        findings.some(
          (item) =>
            item.receiptId === finding.receiptId && item.candidateId === finding.candidateId,
        )
      )
        continue;
      const auto = enabled && autos.length === 1 && found.length === 1 && finding.kind === 'auto';
      let linkedAutomatically = false;
      if (auto) {
        const childId =
          finding.primaryReceiptId === finding.receiptId ? finding.candidateId : finding.receiptId;
        try {
          await linkReceiptOriginalInTransaction(
            tx,
            projectId,
            childId,
            finding.primaryReceiptId!,
            userId,
          );
          linked.add(childId);
          linked.add(finding.primaryReceiptId!);
          await tx.insert(helenaReceiptPairHistory).values({
            projectId,
            teamId: row.teamId,
            receiptId: childId,
            primaryReceiptId: finding.primaryReceiptId!,
            action: 'auto_link',
            createdByUserId: userId,
          });
          linkedAutomatically = true;
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 409) throw error;
        }
      }
      if (!linkedAutomatically) {
        await tx
          .insert(helenaReceiptPairSuggestion)
          .values({
            projectId,
            teamId: row.teamId,
            receiptId: finding.receiptId,
            candidateId: finding.candidateId,
            kind: finding.kind === 'duplicate' ? 'duplicate' : 'pair',
            reason: finding.reason,
          })
          .onConflictDoNothing();
      }
      findings.push({
        ...finding,
        kind: linkedAutomatically ? 'auto' : finding.kind === 'duplicate' ? 'duplicate' : 'pair',
      });
    }
  }
  return findings;
}

export async function inspectAfterIntake(projectId: number, newIds: number[], enabled: boolean) {
  return db.transaction((tx) => inspectNewReceipts(tx, projectId, newIds, enabled));
}

export async function listPairSuggestions(projectId: number) {
  const rows = await db
    .select()
    .from(helenaReceiptPairSuggestion)
    .where(
      and(
        eq(helenaReceiptPairSuggestion.projectId, projectId),
        eq(helenaReceiptPairSuggestion.status, 'pending'),
      ),
    )
    .orderBy(helenaReceiptPairSuggestion.createdAt);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
export async function listPairHistory(projectId: number) {
  const rows = await db
    .select()
    .from(helenaReceiptPairHistory)
    .where(eq(helenaReceiptPairHistory.projectId, projectId))
    .orderBy(sql`${helenaReceiptPairHistory.createdAt} DESC`);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
export async function listTeamPairSuggestions(teamId: number) {
  const rows = await db
    .select({ suggestion: helenaReceiptPairSuggestion, projectKey: projectTable.key })
    .from(helenaReceiptPairSuggestion)
    .innerJoin(projectTable, eq(projectTable.id, helenaReceiptPairSuggestion.projectId))
    .where(
      and(
        eq(helenaReceiptPairSuggestion.teamId, teamId),
        eq(helenaReceiptPairSuggestion.status, 'pending'),
      ),
    )
    .orderBy(helenaReceiptPairSuggestion.createdAt);
  return rows.map(({ suggestion, projectKey }) => ({
    ...suggestion,
    projectKey,
    createdAt: suggestion.createdAt.toISOString(),
  }));
}
export async function listTeamPairHistory(teamId: number) {
  const rows = await db
    .select({ history: helenaReceiptPairHistory, projectKey: projectTable.key })
    .from(helenaReceiptPairHistory)
    .innerJoin(projectTable, eq(projectTable.id, helenaReceiptPairHistory.projectId))
    .where(eq(helenaReceiptPairHistory.teamId, teamId))
    .orderBy(sql`${helenaReceiptPairHistory.createdAt} DESC`);
  return rows.map(({ history, projectKey }) => ({
    ...history,
    projectKey,
    createdAt: history.createdAt.toISOString(),
  }));
}
export async function resolvePairSuggestion(
  projectId: number,
  suggestionId: number,
  action: 'link' | 'ignore',
  primaryReceiptId: number | null,
  userId: string,
) {
  await db.transaction(async (tx) => {
    await lockReceiptProject(tx, projectId);
    const [suggestion] = await tx
      .select()
      .from(helenaReceiptPairSuggestion)
      .where(
        and(
          eq(helenaReceiptPairSuggestion.id, suggestionId),
          eq(helenaReceiptPairSuggestion.projectId, projectId),
        ),
      )
      .for('update');
    if (!suggestion) throw new HttpError(404, 'Suggestion not found');
    if (suggestion.status !== 'pending') throw new HttpError(409, 'Suggestion already resolved');
    if (action === 'link') {
      if (primaryReceiptId !== suggestion.receiptId && primaryReceiptId !== suggestion.candidateId)
        throw new HttpError(400, 'Primary receipt must belong to this suggestion');
      const childId =
        primaryReceiptId === suggestion.receiptId ? suggestion.candidateId : suggestion.receiptId;
      await linkReceiptOriginalInTransaction(tx, projectId, childId, primaryReceiptId, userId);
    }
    await tx
      .update(helenaReceiptPairSuggestion)
      .set({ status: action === 'link' ? 'linked' : 'ignored' })
      .where(eq(helenaReceiptPairSuggestion.id, suggestionId));
  });
  return { ok: true };
}
