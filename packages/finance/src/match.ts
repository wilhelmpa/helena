import { daysBetween, normalizeIban, parseDateAny } from './money';
import { isPaymentIntermediary, nameInText, nameSimilarity } from './names';

export { isPaymentIntermediary, nameSimilarity } from './names';

/**
 * A receipt as the matcher sees it. `direction` is from the owner's view: 'incoming' is a bill
 * we pay (pairs with negative bank amounts), 'outgoing' an invoice we issued (pairs with positive
 * amounts). For a credit note the caller passes the flipped direction: an incoming credit note
 * pairs with money coming in.
 */
export interface MatchReceipt {
  id: number;
  direction: 'incoming' | 'outgoing';
  /** The other party: the seller of a bill, the customer (buyer) of our own invoice. */
  issuer: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  grossCents: number | null;
  dueCents: number | null;
  currency: string;
  iban: string | null;
  creditorId: string | null;
  mandateId: string | null;
  paymentReference: string | null;
  paymentMeansCode: string | null;
  skonto: { days: number; percent: number } | null;
}

export interface MatchTransaction {
  id: number;
  bookingDate: string;
  amountCents: number;
  currency: string;
  counterpartyName: string;
  counterpartyIban: string | null;
  purpose: string;
  endToEndId: string | null;
  mandateId: string | null;
  creditorId: string | null;
}

export interface Candidate {
  transactionId: number;
  score: number;
  amount: 'exact' | 'near' | 'skonto' | 'fee' | 'none';
  reference: boolean;
  identity: 'iban' | 'creditor' | 'name' | 'weak-name' | null;
  dateFit: 'primary' | 'extended' | 'outside';
  signals: string[];
}

/**
 * Score weights. The strongest possible candidate (exact amount, reference, IBAN or creditor id,
 * primary date window) sums to 1.0. A date proximity bonus of at most 0.02 only orders otherwise
 * equal candidates; it can never create the 0.25 margin autoMatch requires.
 */
export const MATCH_WEIGHTS = {
  amount: { exact: 0.4, skonto: 0.3, fee: 0.3, near: 0.1, none: 0 },
  reference: 0.3,
  identity: { iban: 0.2, creditor: 0.2, name: 0.15, 'weak-name': 0.07 },
  dateFit: { primary: 0.08, extended: 0.03, outside: 0 },
  proximity: 0.02,
} as const;

const SKONTO_PERCENTS = [1, 2, 3];

/** Upper-case alphanumerics only, so line breaks and separators inside references do not matter. */
function compact(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * An invoice number is usable as a reference when it is distinctive: at least five characters or
 * a mix of letters and digits, and not something that looks like a date or an amount.
 */
function referenceToken(invoiceNumber: string | null): string | null {
  if (!invoiceNumber) return null;
  const raw = invoiceNumber.trim();
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(raw) || /^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  if (/^-?\d+[.,]\d{2}$/.test(raw)) return null;
  const token = compact(raw);
  const mixed = /[A-Z]/.test(token) && /\d/.test(token);
  if (token.length < 5 && !(mixed && token.length >= 3)) return null;
  if (/^\d{8}$/.test(token) && parseDateAny(token)) return null;
  return token;
}

/** Substring match; a purely numeric reference must not touch other digits ("12345" in an IBAN). */
function containsReference(haystack: string, token: string): boolean {
  const numeric = /^\d+$/.test(token);
  let from = haystack.indexOf(token);
  while (from >= 0) {
    const before = haystack[from - 1] ?? '';
    const after = haystack[from + token.length] ?? '';
    if (!numeric || (!/\d/.test(before) && !/\d/.test(after))) return true;
    from = haystack.indexOf(token, from + 1);
  }
  return false;
}

function classifyAmount(
  receipt: MatchReceipt,
  tx: MatchTransaction,
  signals: string[],
): Candidate['amount'] {
  const targets = [receipt.dueCents, receipt.grossCents].filter((c): c is number => c !== null);
  const target = targets[0];
  if (target === undefined) return 'none';
  const paid = Math.abs(tx.amountCents);
  const expected = Math.abs(target);
  if (targets.some((t) => Math.abs(paid - Math.abs(t)) <= 2)) {
    signals.push('amount:exact');
    return 'exact';
  }
  if (paid < expected) {
    const percents = receipt.skonto ? [receipt.skonto.percent] : SKONTO_PERCENTS;
    for (const percent of percents) {
      if (Math.abs(paid - Math.round((expected * (100 - percent)) / 100)) <= 3) {
        signals.push(`amount:skonto ${percent}%`);
        return 'skonto';
      }
    }
    // Payment providers deduct their fee from money coming in.
    const shortfall = expected - paid;
    if (tx.amountCents > 0 && (shortfall <= 500 || shortfall * 100 <= expected)) {
      signals.push(`amount:fee ${shortfall}`);
      return 'fee';
    }
  }
  if (Math.abs(paid - expected) * 100 <= expected * 3) {
    signals.push(`amount:near ${paid - expected}`);
    return 'near';
  }
  return 'none';
}

interface DateWindow {
  fit: Candidate['dateFit'];
  distance: number;
}

/**
 * Date windows relative to the invoice date (or the due date when there is no invoice date):
 * - transfer for a bill: primary -5..+45 days, stretched to due date + 14; extended to +90
 * - direct debit: primary due date ±5 (extended ±14), or invoice date..+20 (extended -5..+45)
 *   without a due date
 * - our own invoice: primary -3..+60 (or due date + 14); extended to +180
 * Everything else inside -90..+120 (+180 for our invoices) is 'outside'; beyond that dropped.
 */
function dateWindow(
  receipt: MatchReceipt,
  tx: MatchTransaction,
  directDebit: boolean,
): DateWindow | null {
  const anchor = receipt.invoiceDate ?? receipt.dueDate;
  if (!anchor) return { fit: 'extended', distance: 0 };
  const delta = daysBetween(anchor, tx.bookingDate);
  const dueDelta = receipt.dueDate ? daysBetween(anchor, receipt.dueDate) : null;
  const outgoing = receipt.direction === 'outgoing';
  const hardEnd = outgoing ? 180 : 120;
  if (delta < -90 || delta > hardEnd) return null;
  if (directDebit && !outgoing) {
    // A creditor collects on the due date, so a collection far from it is usually the next bill.
    if (dueDelta !== null) {
      const off = Math.abs(delta - dueDelta);
      return { fit: off <= 5 ? 'primary' : off <= 14 ? 'extended' : 'outside', distance: off };
    }
    const fit =
      delta >= 0 && delta <= 20 ? 'primary' : delta >= -5 && delta <= 45 ? 'extended' : 'outside';
    return { fit, distance: Math.abs(delta) };
  }
  const primaryStart = outgoing ? -3 : -5;
  const primaryEnd = Math.max(outgoing ? 60 : 45, dueDelta !== null ? dueDelta + 14 : 0);
  const expectedDelta = dueDelta ?? 0;
  const distance = Math.abs(delta - expectedDelta);
  if (delta >= primaryStart && delta <= primaryEnd) return { fit: 'primary', distance };
  if (delta > primaryEnd && delta <= (outgoing ? 180 : 90)) return { fit: 'extended', distance };
  return { fit: 'outside', distance };
}

function identityOf(
  receipt: MatchReceipt,
  tx: MatchTransaction,
  signals: string[],
): Candidate['identity'] {
  const receiptIban = receipt.iban ? normalizeIban(receipt.iban) : null;
  if (receiptIban && tx.counterpartyIban && receiptIban === normalizeIban(tx.counterpartyIban)) {
    signals.push('identity:iban');
    return 'iban';
  }
  const same = (a: string | null, b: string | null) => !!a && !!b && compact(a) === compact(b);
  if (same(receipt.creditorId, tx.creditorId) || same(receipt.mandateId, tx.mandateId)) {
    signals.push('identity:creditor');
    return 'creditor';
  }
  if (!receipt.issuer) return null;
  // Behind a payment provider (or without any name) the merchant can only show up in the purpose.
  if (!tx.counterpartyName.trim() || isPaymentIntermediary(tx.counterpartyName)) {
    if (tx.counterpartyName.trim()) signals.push(`intermediary:${tx.counterpartyName}`);
    const inPurpose = nameInText(receipt.issuer, tx.purpose);
    if (inPurpose) signals.push(`identity:name-in-purpose ${inPurpose}`);
    if (inPurpose === 'full') return 'name';
    return inPurpose === 'partial' ? 'weak-name' : null;
  }
  const similarity = nameSimilarity(receipt.issuer, tx.counterpartyName);
  if (similarity >= 0.9) {
    signals.push(`identity:name ${similarity}`);
    return 'name';
  }
  if (similarity >= 0.8) {
    signals.push(`identity:weak-name ${similarity}`);
    return 'weak-name';
  }
  return null;
}

function referenceOf(receipt: MatchReceipt, tx: MatchTransaction, signals: string[]): boolean {
  const haystack = `${compact(tx.purpose)} ${compact(tx.endToEndId ?? '')}`;
  const token = referenceToken(receipt.invoiceNumber);
  if (token && containsReference(haystack, token)) {
    signals.push('reference:invoice-number');
    return true;
  }
  const payment = receipt.paymentReference ? compact(receipt.paymentReference) : '';
  if (payment.length >= 4 && containsReference(haystack, payment)) {
    signals.push('reference:payment-reference');
    return true;
  }
  return false;
}

/**
 * Scores every transaction against one receipt and returns the plausible ones, best first.
 * Transactions with the wrong sign, another currency, an amount that fits in no way (unless a
 * reference or identity still ties them together when the receipt has no amount), or a date far
 * outside the windows are dropped.
 */
export function rankCandidates(
  receipt: MatchReceipt,
  transactions: MatchTransaction[],
  options: { maxCandidates?: number } = {},
): Candidate[] {
  const wantSign = receipt.direction === 'incoming' ? -1 : 1;
  const directDebit =
    !!receipt.mandateId || !!receipt.creditorId || receipt.paymentMeansCode === '59';
  const hasAmount = receipt.dueCents !== null || receipt.grossCents !== null;
  const candidates: Candidate[] = [];
  for (const tx of transactions) {
    if (Math.sign(tx.amountCents) !== wantSign) continue;
    if (tx.currency.toUpperCase() !== receipt.currency.toUpperCase()) continue;
    const signals: string[] = [];
    const amount = classifyAmount(receipt, tx, signals);
    const window = dateWindow(receipt, tx, directDebit);
    if (!window) continue;
    const reference = referenceOf(receipt, tx, signals);
    const identity = identityOf(receipt, tx, signals);
    if (
      amount === 'none' &&
      (hasAmount || (!reference && identity !== 'iban' && identity !== 'creditor'))
    )
      continue;
    signals.push(
      `date:${window.fit} ${daysBetween(receipt.invoiceDate ?? receipt.dueDate ?? tx.bookingDate, tx.bookingDate)}d`,
    );
    const proximity = MATCH_WEIGHTS.proximity * Math.max(0, 1 - window.distance / 60);
    const score =
      MATCH_WEIGHTS.amount[amount] +
      (reference ? MATCH_WEIGHTS.reference : 0) +
      (identity ? MATCH_WEIGHTS.identity[identity] : 0) +
      MATCH_WEIGHTS.dateFit[window.fit] +
      proximity;
    candidates.push({
      transactionId: tx.id,
      score: Math.round(Math.min(1, score) * 1000) / 1000,
      amount,
      reference,
      identity,
      dateFit: window.fit,
      signals,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.transactionId - b.transactionId);
  return candidates.slice(0, options.maxCandidates ?? 10);
}

/**
 * Picks a candidate without asking anyone, only when it is unambiguous: exact amount, primary date
 * window, a reference or a strong identity (IBAN, creditor id, name), and a clear lead of at least
 * 0.25 over the runner-up. Otherwise null: the caller asks the decision model or the owner.
 */
export function autoMatch(candidates: Candidate[]): Candidate | null {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const [top, second] = sorted;
  if (!top) return null;
  const strong =
    top.reference ||
    top.identity === 'iban' ||
    top.identity === 'creditor' ||
    top.identity === 'name';
  if (top.amount !== 'exact' || top.dateFit !== 'primary' || !strong) return null;
  if (second && top.score - second.score < 0.25 - 1e-9) return null;
  return top;
}
