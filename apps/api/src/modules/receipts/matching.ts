import {
  addDays,
  autoMatch,
  rankCandidates,
  type Candidate,
  type MatchReceipt,
  type MatchTransaction,
} from '@helena/finance';
import { db, helenaBankTransaction, helenaReceipt, helenaReceiptMatch } from '@repo/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm';
import { economicReceipt, assertEconomicReceipt } from './originals';
import { HttpError } from '#shared/lib';
import { RECEIPTS_CLASS } from '#modules/decisions/classes';
import {
  NO_TRANSACTION,
  receiptContext,
  receiptQuestions,
  transactionOptionId,
} from '#modules/decisions/questions';
import {
  decide,
  recordOutcome,
  type DecideOutcome,
  type DecideRequest,
} from '#modules/decisions/service';
import { centsToNumeric, monthRange, numericToCents } from './amounts';
import {
  detailsOf,
  inMonth,
  receiptViews,
  transactionViews,
  type ReceiptRow,
  type ReceiptView,
  type TransactionRow,
  type TransactionView,
} from './views';

// Matching a receipt to the bank transaction that pays it (docs/helena-decisions/decisions.md
// §7). The rules of @helena/finance rank the open transactions; one that fits beyond doubt
// (exact amount, in its date window, a reference or the payee, clearly ahead of the rest) is
// matched at once. Otherwise the decision model picks among the best six: its confident pick is
// matched when it agrees with the rules or the amount is exact, anything else waits in the
// review list for the owner, whose answer goes back to the decision log.

const DECISION_OPTIONS = 6;
const REMATCH_LIMIT = 50;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Decider = (request: DecideRequest) => Promise<DecideOutcome>;

let decider: Decider = decide;

// Tests (and a plugin that brings its own model) put another decider in place; null restores
// the decisions service.
export function useReceiptDecider(next: Decider | null): void {
  decider = next ?? decide;
}

export interface MatchOutcome {
  status: 'confirmed' | 'proposed' | 'none' | 'no_candidates' | 'skipped';
  matchId: number | null;
  transactionId: number | null;
  method: 'rule' | 'decision' | 'manual' | null;
  decision: { status: string; choice: string | null; confidence: number | null } | null;
}

export interface CandidateView {
  transaction: TransactionView;
  score: number;
  amount: Candidate['amount'];
  reference: boolean;
  identity: Candidate['identity'];
  dateFit: Candidate['dateFit'];
  signals: string[];
}

export interface ReviewItem {
  matchId: number;
  method: string;
  score: number | null;
  confidence: number | null;
  receipt: ReceiptView;
  transaction: TransactionView;
  candidates: CandidateView[];
}

// The receipt as the rules see it. A credit note moves money the other way, and for an invoice
// the project wrote, the other party is its buyer and the IBAN on it is the project's own.
function matchReceiptOf(row: ReceiptRow): MatchReceipt {
  const details = detailsOf(row);
  const outgoing = row.direction === 'outgoing';
  const flipped = details.creditNote === true;
  return {
    id: row.id,
    direction: outgoing !== flipped ? 'outgoing' : 'incoming',
    issuer: outgoing ? (details.buyerName ?? null) : row.issuer,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    grossCents: numericToCents(row.totalGross),
    dueCents: details.dueCents ?? null,
    currency: row.currency,
    iban: outgoing ? null : row.iban,
    creditorId: details.creditorId ?? null,
    mandateId: details.mandateId ?? null,
    paymentReference: details.paymentReference ?? null,
    paymentMeansCode: details.paymentMeansCode ?? null,
    skonto: details.skonto ?? null,
  };
}

function matchTransactionOf(row: TransactionRow): MatchTransaction {
  return {
    id: row.id,
    bookingDate: row.bookingDate,
    amountCents: numericToCents(row.amount) ?? 0,
    currency: row.currency,
    counterpartyName: row.counterpartyName,
    counterpartyIban: row.counterpartyIban,
    purpose: row.purpose,
    endToEndId: row.endToEndId,
    mandateId: row.mandateId,
    creditorId: row.creditorId,
  };
}

// The open transactions a receipt could belong to: in the widest date window the rules allow,
// without the ones the owner already rejected for it (plus `include`, for the review list).
async function candidatesFor(row: ReceiptRow, include: number[] = []) {
  const [economic] = await db
    .select({ id: helenaReceipt.id })
    .from(helenaReceipt)
    .where(and(eq(helenaReceipt.id, row.id), economicReceipt));
  if (!economic) return { candidates: [], byId: new Map<number, TransactionRow>() };

  const rejected = await db
    .select({ id: helenaReceiptMatch.transactionId })
    .from(helenaReceiptMatch)
    .where(
      and(eq(helenaReceiptMatch.receiptId, row.id), eq(helenaReceiptMatch.status, 'rejected')),
    );
  const anchor = row.invoiceDate ?? row.dueDate;
  const transactions = await db
    .select()
    .from(helenaBankTransaction)
    .where(
      and(
        eq(helenaBankTransaction.projectId, row.projectId),
        include.length
          ? sql`(${helenaBankTransaction.status} = 'open' OR ${inArray(helenaBankTransaction.id, include)})`
          : eq(helenaBankTransaction.status, 'open'),
        anchor ? gte(helenaBankTransaction.bookingDate, addDays(anchor, -90)) : undefined,
        anchor ? lte(helenaBankTransaction.bookingDate, addDays(anchor, 185)) : undefined,
        rejected.length
          ? notInArray(
              helenaBankTransaction.id,
              rejected.map((r) => r.id),
            )
          : undefined,
      ),
    )
    .orderBy(asc(helenaBankTransaction.bookingDate))
    .limit(5000);
  const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
  const candidates = rankCandidates(matchReceiptOf(row), transactions.map(matchTransactionOf), {
    maxCandidates: 20,
  });
  return { candidates, byId };
}

async function confirm(
  tx: Tx,
  row: ReceiptRow,
  transactionId: number,
  fields: {
    method: 'rule' | 'decision' | 'manual';
    score: number | null;
    confidence: number | null;
    decisionId: number | null;
    userId: string | null;
  },
): Promise<number> {
  await assertEconomicReceipt(tx, row.projectId, row.id);
  await tx
    .delete(helenaReceiptMatch)
    .where(
      and(
        eq(helenaReceiptMatch.receiptId, row.id),
        eq(helenaReceiptMatch.status, 'proposed'),
        ne(helenaReceiptMatch.transactionId, transactionId),
      ),
    );
  const values = {
    status: 'confirmed',
    method: fields.method,
    score: fields.score,
    confidence: fields.confidence,
    decisionId: fields.decisionId,
    decidedByUserId: fields.userId,
    decidedAt: new Date(),
  };
  const [match] = await tx
    .insert(helenaReceiptMatch)
    .values({
      teamId: row.teamId,
      projectId: row.projectId,
      receiptId: row.id,
      transactionId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [helenaReceiptMatch.receiptId, helenaReceiptMatch.transactionId],
      set: values,
    })
    .returning({ id: helenaReceiptMatch.id });
  await tx.update(helenaReceipt).set({ status: 'matched' }).where(eq(helenaReceipt.id, row.id));
  await tx
    .update(helenaBankTransaction)
    .set({ status: 'matched' })
    .where(eq(helenaBankTransaction.id, transactionId));
  return match!.id;
}

async function propose(
  row: ReceiptRow,
  transactionId: number,
  fields: {
    method: 'rule' | 'decision';
    score: number;
    confidence: number | null;
    decisionId: number | null;
  },
): Promise<number> {
  return db.transaction(async (tx) => {
    await assertEconomicReceipt(tx, row.projectId, row.id);
    const values = { status: 'proposed', ...fields, decidedByUserId: null, decidedAt: null };
    const [match] = await tx
      .insert(helenaReceiptMatch)
      .values({
        teamId: row.teamId,
        projectId: row.projectId,
        receiptId: row.id,
        transactionId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [helenaReceiptMatch.receiptId, helenaReceiptMatch.transactionId],
        set: values,
      })
      .returning({ id: helenaReceiptMatch.id });
    return match!.id;
  });
}

// The right answer of a decision, once the owner gave it. A transaction the model was not
// offered counts as "none of these".
async function learn(teamId: number, decisionId: number | null, transactionId: number | null) {
  if (!decisionId) return;
  const outcome = transactionId === null ? NO_TRANSACTION : transactionOptionId(transactionId);
  try {
    await recordOutcome(teamId, decisionId, outcome, 'caller');
  } catch {
    if (outcome !== NO_TRANSACTION)
      await recordOutcome(teamId, decisionId, NO_TRANSACTION, 'caller').catch(() => false);
  }
}

async function askModel(
  row: ReceiptRow,
  options: Candidate[],
  byId: Map<number, TransactionRow>,
): Promise<DecideOutcome | null> {
  const offered = options.map((candidate) => {
    const transaction = byId.get(candidate.transactionId)!;
    return {
      id: transaction.id,
      bookingDate: transaction.bookingDate,
      amount: transaction.amount,
      currency: transaction.currency,
      counterpartyName: transaction.counterpartyName,
      counterpartyIban: transaction.counterpartyIban,
      purpose: transaction.purpose,
    };
  });
  const gross = numericToCents(row.totalGross);
  try {
    return await decider({
      teamId: row.teamId,
      classId: RECEIPTS_CLASS,
      context: receiptContext({
        issuer: row.issuer,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.invoiceDate,
        dueDate: row.dueDate,
        totalGross: gross === null ? null : centsToNumeric(gross),
        currency: row.currency,
        iban: row.iban,
        direction: row.direction === 'outgoing' ? 'outgoing' : 'incoming',
        filename: row.filename,
        text: row.textExcerpt,
      }),
      questions: receiptQuestions(offered),
      subject: `receipt:${row.id}`,
      projectId: row.projectId,
    });
  } catch (error) {
    console.error(`[receipts] no decision for receipt ${row.id}`, error);
    return null;
  }
}

/**
 * Matches one open receipt: by the rules alone when that is beyond doubt, else by the decision
 * model's confident pick, else as a proposal for the review list. A receipt that is matched or
 * ignored is left alone.
 */
export async function matchReceipt(receiptId: number): Promise<MatchOutcome> {
  const none: MatchOutcome = {
    status: 'skipped',
    matchId: null,
    transactionId: null,
    method: null,
    decision: null,
  };
  const [row] = await db
    .select()
    .from(helenaReceipt)
    .where(and(eq(helenaReceipt.id, receiptId), economicReceipt));
  if (!row || row.status !== 'open') return none;
  await db
    .delete(helenaReceiptMatch)
    .where(
      and(eq(helenaReceiptMatch.receiptId, row.id), eq(helenaReceiptMatch.status, 'proposed')),
    );
  const { candidates, byId } = await candidatesFor(row);
  const top = candidates[0];
  if (!top) return { ...none, status: 'no_candidates' };

  const sure = autoMatch(candidates);
  if (sure) {
    const matchId = await db.transaction((tx) =>
      confirm(tx, row, sure.transactionId, {
        method: 'rule',
        score: sure.score,
        confidence: null,
        decisionId: null,
        userId: null,
      }),
    );
    return {
      ...none,
      status: 'confirmed',
      matchId,
      transactionId: sure.transactionId,
      method: 'rule',
    };
  }

  const outcome = await askModel(row, candidates.slice(0, DECISION_OPTIONS), byId);
  const answer = outcome?.answers.match ?? null;
  const decision = outcome
    ? {
        status: outcome.status,
        choice: answer?.choice ?? null,
        confidence: answer?.confidence ?? null,
      }
    : null;
  const decisionId = answer?.decisionId ?? null;
  const chosenId =
    answer?.choice && answer.choice !== NO_TRANSACTION ? Number(answer.choice.slice(2)) : null;
  const chosen =
    chosenId === null ? undefined : candidates.find((c) => c.transactionId === chosenId);

  if (answer?.decided && answer.choice === NO_TRANSACTION)
    return { ...none, status: 'none', decision };
  if (answer?.decided && chosen) {
    // The model's pick stands alone when the rules agree or the amount is exact.
    if (chosen.transactionId === top.transactionId || chosen.amount === 'exact') {
      const matchId = await db.transaction((tx) =>
        confirm(tx, row, chosen.transactionId, {
          method: 'decision',
          score: chosen.score,
          confidence: answer.confidence,
          decisionId,
          userId: null,
        }),
      );
      return {
        ...none,
        status: 'confirmed',
        matchId,
        transactionId: chosen.transactionId,
        method: 'decision',
        decision,
      };
    }
    const matchId = await propose(row, chosen.transactionId, {
      method: 'decision',
      score: chosen.score,
      confidence: answer.confidence,
      decisionId,
    });
    return {
      ...none,
      status: 'proposed',
      matchId,
      transactionId: chosen.transactionId,
      method: 'decision',
      decision,
    };
  }
  // Not sure, or no model: the rules' best candidate waits for the owner.
  const matchId = await propose(row, top.transactionId, {
    method: 'rule',
    score: top.score,
    confidence: answer?.probabilities?.[transactionOptionId(top.transactionId)] ?? null,
    decisionId,
  });
  return {
    ...none,
    status: 'proposed',
    matchId,
    transactionId: top.transactionId,
    method: 'rule',
    decision,
  };
}

// After an import: the open receipts that wait for a transaction, newest first. Returns how
// many were matched.
export async function rematchOpenReceipts(projectId: number): Promise<number> {
  const waiting = await db
    .select({ id: helenaReceipt.id })
    .from(helenaReceipt)
    .where(
      and(
        eq(helenaReceipt.projectId, projectId),
        eq(helenaReceipt.status, 'open'),
        economicReceipt,
        sql`NOT EXISTS (SELECT 1 FROM ${helenaReceiptMatch} WHERE ${helenaReceiptMatch.receiptId} = ${helenaReceipt.id} AND ${helenaReceiptMatch.status} = 'proposed')`,
      ),
    )
    .orderBy(desc(helenaReceipt.createdAt))
    .limit(REMATCH_LIMIT);
  let matched = 0;
  for (const { id } of waiting) {
    const outcome = await matchReceipt(id).catch((error: unknown) => {
      console.error(`[receipts] receipt ${id} not matched`, error);
      return null;
    });
    if (outcome?.status === 'confirmed') matched += 1;
  }
  return matched;
}

async function requireMatch(projectId: number, matchId: number) {
  const [row] = await db
    .select()
    .from(helenaReceiptMatch)
    .where(and(eq(helenaReceiptMatch.id, matchId), eq(helenaReceiptMatch.projectId, projectId)));
  if (!row) throw new HttpError(404, 'Match not found');
  return row;
}

async function receiptRow(receiptId: number): Promise<ReceiptRow> {
  const [row] = await db.select().from(helenaReceipt).where(eq(helenaReceipt.id, receiptId));
  if (!row) throw new HttpError(404, 'Receipt not found');
  return row;
}

async function receiptView(receiptId: number): Promise<ReceiptView> {
  const [view] = await receiptViews([await receiptRow(receiptId)]);
  return view!;
}

// A transaction that lost its last confirmed receipt is open again.
async function reopenTransaction(tx: Tx, transactionId: number) {
  const [left] = await tx
    .select({ n: count() })
    .from(helenaReceiptMatch)
    .where(
      and(
        eq(helenaReceiptMatch.transactionId, transactionId),
        eq(helenaReceiptMatch.status, 'confirmed'),
      ),
    );
  if (!left?.n)
    await tx
      .update(helenaBankTransaction)
      .set({ status: 'open' })
      .where(
        and(
          eq(helenaBankTransaction.id, transactionId),
          eq(helenaBankTransaction.status, 'matched'),
        ),
      );
}

// Before a receipt goes: its confirmed transactions are open again.
export async function unlinkReceipt(tx: Tx, receiptId: number): Promise<void> {
  const matches = await tx
    .delete(helenaReceiptMatch)
    .where(eq(helenaReceiptMatch.receiptId, receiptId))
    .returning({
      transactionId: helenaReceiptMatch.transactionId,
      status: helenaReceiptMatch.status,
    });
  for (const match of matches)
    if (match.status === 'confirmed') await reopenTransaction(tx, match.transactionId);
}

export async function confirmProposal(
  projectId: number,
  matchId: number,
  userId: string,
): Promise<ReceiptView> {
  const match = await requireMatch(projectId, matchId);
  if (match.status !== 'proposed') throw new HttpError(409, 'This match is not a proposal.');
  const row = await receiptRow(match.receiptId);
  if (row.status === 'matched') throw new HttpError(409, 'The receipt is matched already.');
  const [transaction] = await db
    .select({ status: helenaBankTransaction.status })
    .from(helenaBankTransaction)
    .where(eq(helenaBankTransaction.id, match.transactionId));
  if (transaction?.status === 'matched')
    throw new HttpError(409, 'The transaction has a receipt already.');
  await db.transaction((tx) =>
    confirm(tx, row, match.transactionId, {
      method: match.method === 'decision' ? 'decision' : 'rule',
      score: match.score,
      confidence: match.confidence,
      decisionId: match.decisionId,
      userId,
    }),
  );
  await learn(row.teamId, match.decisionId, match.transactionId);
  return receiptView(row.id);
}

export async function rejectProposal(
  projectId: number,
  matchId: number,
  userId: string,
): Promise<ReceiptView> {
  const match = await requireMatch(projectId, matchId);
  if (match.status !== 'proposed') throw new HttpError(409, 'This match is not a proposal.');
  await db
    .update(helenaReceiptMatch)
    .set({ status: 'rejected', decidedByUserId: userId, decidedAt: new Date() })
    .where(eq(helenaReceiptMatch.id, match.id));
  await learn(match.teamId, match.decisionId, null);
  return receiptView(match.receiptId);
}

/** The owner picks the transaction; a match the receipt had is replaced. */
export async function matchManually(
  projectId: number,
  receiptId: number,
  transactionId: number,
  userId: string,
): Promise<ReceiptView> {
  const row = await receiptRow(receiptId);
  if (row.projectId !== projectId) throw new HttpError(404, 'Receipt not found');
  const [transaction] = await db
    .select()
    .from(helenaBankTransaction)
    .where(
      and(
        eq(helenaBankTransaction.id, transactionId),
        eq(helenaBankTransaction.projectId, projectId),
      ),
    );
  if (!transaction) throw new HttpError(404, 'Transaction not found');
  const [latest] = await db
    .select({ decisionId: helenaReceiptMatch.decisionId })
    .from(helenaReceiptMatch)
    .where(and(eq(helenaReceiptMatch.receiptId, row.id), isNotNull(helenaReceiptMatch.decisionId)))
    .orderBy(desc(helenaReceiptMatch.createdAt))
    .limit(1);
  const score =
    rankCandidates(matchReceiptOf(row), [matchTransactionOf(transaction)])[0]?.score ?? null;
  await db.transaction(async (tx) => {
    await assertEconomicReceipt(tx, projectId, row.id);
    const previous = await tx
      .delete(helenaReceiptMatch)
      .where(
        and(
          eq(helenaReceiptMatch.receiptId, row.id),
          eq(helenaReceiptMatch.status, 'confirmed'),
          ne(helenaReceiptMatch.transactionId, transactionId),
        ),
      )
      .returning({ transactionId: helenaReceiptMatch.transactionId });
    for (const match of previous) await reopenTransaction(tx, match.transactionId);
    await confirm(tx, row, transactionId, {
      method: 'manual',
      score,
      confidence: null,
      decisionId: latest?.decisionId ?? null,
      userId,
    });
  });
  await learn(row.teamId, latest?.decisionId ?? null, transactionId);
  return receiptView(row.id);
}

/** Removes a match (a confirmed one or a proposal); both sides are open again. */
export async function removeMatch(projectId: number, matchId: number): Promise<void> {
  const match = await requireMatch(projectId, matchId);
  await db.transaction(async (tx) => {
    await tx.delete(helenaReceiptMatch).where(eq(helenaReceiptMatch.id, match.id));
    if (match.status !== 'confirmed') return;
    await tx
      .update(helenaReceipt)
      .set({ status: 'open' })
      .where(and(eq(helenaReceipt.id, match.receiptId), eq(helenaReceipt.status, 'matched')));
    await reopenTransaction(tx, match.transactionId);
  });
  // The model matched this one on its own and the owner undid it: it was wrong.
  if (match.status === 'confirmed' && match.method === 'decision')
    await learn(match.teamId, match.decisionId, null);
}

/** The proposals waiting for the owner, each with the candidates the rules see. */
export async function reviewList(projectId: number, month: string | null): Promise<ReviewItem[]> {
  const range = month ? monthRange(month) : null;
  const day = sql`coalesce(${helenaReceipt.invoiceDate}, (${helenaReceipt.createdAt} AT TIME ZONE 'UTC')::date)`;
  const proposals = await db
    .select({ match: helenaReceiptMatch, receipt: helenaReceipt })
    .from(helenaReceiptMatch)
    .innerJoin(helenaReceipt, eq(helenaReceipt.id, helenaReceiptMatch.receiptId))
    .where(
      and(
        eq(helenaReceiptMatch.projectId, projectId),
        eq(helenaReceiptMatch.status, 'proposed'),
        economicReceipt,
        range ? inMonth(day, range) : undefined,
      ),
    )
    .orderBy(desc(helenaReceiptMatch.createdAt))
    .limit(100);
  if (!proposals.length) return [];
  const receipts = await receiptViews(proposals.map((p) => p.receipt));
  const items: ReviewItem[] = [];
  for (const [index, { match, receipt }] of proposals.entries()) {
    const { candidates, byId } = await candidatesFor(receipt, [match.transactionId]);
    const shown = candidates.slice(0, DECISION_OPTIONS);
    const rows = [...new Set([match.transactionId, ...shown.map((c) => c.transactionId)])].flatMap(
      (id) => (byId.has(id) ? [byId.get(id)!] : []),
    );
    const views = new Map((await transactionViews(rows)).map((view) => [view.id, view]));
    const proposed = views.get(match.transactionId);
    if (!proposed) continue;
    items.push({
      matchId: match.id,
      method: match.method,
      score: match.score,
      confidence: match.confidence,
      receipt: receipts[index]!,
      transaction: proposed,
      candidates: shown.flatMap((candidate) => {
        const transaction = views.get(candidate.transactionId);
        return transaction
          ? [
              {
                transaction,
                score: candidate.score,
                amount: candidate.amount,
                reference: candidate.reference,
                identity: candidate.identity,
                dateFit: candidate.dateFit,
                signals: candidate.signals,
              },
            ]
          : [];
      }),
    });
  }
  return items;
}

// The candidates for one receipt, for the manual pick in the receipt's detail.
export async function receiptCandidates(
  projectId: number,
  receiptId: number,
): Promise<CandidateView[]> {
  const row = await receiptRow(receiptId);
  if (row.projectId !== projectId) throw new HttpError(404, 'Receipt not found');
  const { candidates, byId } = await candidatesFor(row);
  const shown = candidates.slice(0, 10);
  const views = new Map(
    (await transactionViews(shown.map((c) => byId.get(c.transactionId)!))).map((v) => [v.id, v]),
  );
  return shown.map((candidate) => ({
    transaction: views.get(candidate.transactionId)!,
    score: candidate.score,
    amount: candidate.amount,
    reference: candidate.reference,
    identity: candidate.identity,
    dateFit: candidate.dateFit,
    signals: candidate.signals,
  }));
}
