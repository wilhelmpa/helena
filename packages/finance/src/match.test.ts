import { describe, expect, test } from 'bun:test';

import {
  autoMatch,
  isPaymentIntermediary,
  nameSimilarity,
  rankCandidates,
  type MatchReceipt,
  type MatchTransaction,
} from './match';

const SELLER_IBAN = 'DE42500105175407324385';

function receipt(overrides: Partial<MatchReceipt> = {}): MatchReceipt {
  return {
    id: 1,
    direction: 'incoming',
    issuer: 'Muster Software GmbH',
    invoiceNumber: 'MS-10023',
    invoiceDate: '2026-09-01',
    dueDate: '2026-10-01',
    grossCents: 17250,
    dueCents: 17250,
    currency: 'EUR',
    iban: SELLER_IBAN,
    creditorId: null,
    mandateId: null,
    paymentReference: null,
    paymentMeansCode: '58',
    skonto: null,
    ...overrides,
  };
}

let nextId = 100;
function tx(overrides: Partial<MatchTransaction> = {}): MatchTransaction {
  return {
    id: nextId++,
    bookingDate: '2026-09-20',
    amountCents: -17250,
    currency: 'EUR',
    counterpartyName: 'MUSTER SOFTWARE GMBH',
    counterpartyIban: SELLER_IBAN,
    purpose: '',
    endToEndId: null,
    mandateId: null,
    creditorId: null,
    ...overrides,
  };
}

describe('rankCandidates and autoMatch', () => {
  test('exact amount plus invoice number is matched automatically', () => {
    const right = tx({ purpose: 'Rechnung MS 10023 Kd 4711' });
    const other = tx({
      counterpartyName: 'Andere Firma GmbH',
      counterpartyIban: 'DE17100500000123456789',
    });
    const wrongSign = tx({ amountCents: 17250 });
    const candidates = rankCandidates(receipt(), [other, wrongSign, right]);
    expect(candidates.map((c) => c.transactionId)).toEqual([right.id, other.id]);
    expect(candidates[0]).toMatchObject({
      amount: 'exact',
      reference: true,
      identity: 'iban',
      dateFit: 'primary',
    });
    expect(candidates[0]?.score).toBeGreaterThan(0.95);
    expect(autoMatch(candidates)?.transactionId).toBe(right.id);
  });

  test('two equal payments to the same payee are not decided automatically', () => {
    const a = tx({ bookingDate: '2026-09-03', purpose: 'Hosting' });
    const b = tx({ bookingDate: '2026-09-05', purpose: 'Hosting' });
    const candidates = rankCandidates(receipt({ invoiceNumber: 'H-1' }), [a, b]);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.identity === 'iban' && !c.reference)).toBe(true);
    expect(autoMatch(candidates)).toBeNull();
  });

  test('Skonto payment is found but left to a decision', () => {
    const paid = tx({
      amountCents: -16905,
      bookingDate: '2026-09-10',
      purpose: 'MS-10023 abzgl. 2% Skonto',
    });
    const candidates = rankCandidates(receipt({ skonto: { days: 14, percent: 2 } }), [paid]);
    expect(candidates[0]).toMatchObject({ amount: 'skonto', reference: true });
    expect(candidates[0]?.signals).toContain('amount:skonto 2%');
    expect(autoMatch(candidates)).toBeNull();
  });

  test('direct debit: creditor id, collection on the due date', () => {
    const bill = receipt({
      issuer: 'Stadtwerke Musterstadt GmbH',
      invoiceNumber: '2026-0042',
      invoiceDate: '2026-09-05',
      dueDate: '2026-09-19',
      grossCents: 8990,
      dueCents: 8990,
      iban: null,
      creditorId: 'DE98ZZZ09999999999',
      mandateId: 'M-4711',
      paymentMeansCode: '59',
    });
    const debit = (bookingDate: string, purpose: string) =>
      tx({
        bookingDate,
        amountCents: -8990,
        counterpartyName: 'Stadtwerke Musterstadt GmbH',
        counterpartyIban: 'DE45120300001234567890',
        creditorId: 'DE98 ZZZ0 9999 9999 99',
        mandateId: 'M-4711',
        purpose,
      });
    const september = debit('2026-09-19', 'Abschlag Rechnung 2026-0042');
    const august = debit('2026-08-19', 'Abschlag Rechnung 2026-0031');
    const candidates = rankCandidates(bill, [august, september]);
    expect(candidates[0]).toMatchObject({
      transactionId: september.id,
      identity: 'creditor',
      dateFit: 'primary',
      reference: true,
    });
    expect(candidates[1]).toMatchObject({ transactionId: august.id, dateFit: 'outside' });
    expect(autoMatch(candidates)?.transactionId).toBe(september.id);

    // Without the invoice number in the purpose the previous month is still too close to call.
    const plain = rankCandidates({ ...bill, invoiceNumber: null }, [
      debit('2026-08-19', 'Abschlag'),
      debit('2026-09-19', 'Abschlag'),
    ]);
    expect(plain[0]?.dateFit).toBe('primary');
    expect(autoMatch(plain)).toBeNull();
  });

  test('PayPal: the merchant is looked up in the purpose', () => {
    const shop = receipt({
      issuer: 'Muster Shop GmbH',
      invoiceNumber: '1001',
      invoiceDate: '2026-09-20',
      dueDate: null,
      grossCents: 4995,
      dueCents: 4995,
      iban: null,
    });
    const paypal = (purpose: string, bookingDate: string) =>
      tx({
        bookingDate,
        amountCents: -4995,
        counterpartyName: 'PayPal Europe S.a.r.l. et Cie S.C.A',
        counterpartyIban: 'LU120010001234567891',
        purpose,
      });
    const right = paypal(
      '1040000123456 PP.1234.PP . Muster Shop GmbH, Ihr Einkauf bei Muster Shop GmbH',
      '2026-09-22',
    );
    const other = paypal(
      '1040000999999 PP.1234.PP . Anderer Laden, Ihr Einkauf bei Anderer Laden',
      '2026-09-21',
    );
    const candidates = rankCandidates(shop, [other, right]);
    expect(candidates[0]).toMatchObject({
      transactionId: right.id,
      identity: 'name',
      reference: false,
    });
    expect(candidates[0]?.signals.some((s) => s.startsWith('intermediary:'))).toBe(true);
    expect(candidates[1]?.identity).toBeNull();
    // A lead of 0.15 is not enough to decide alone; with only the right payment it is.
    expect(autoMatch(candidates)).toBeNull();
    expect(autoMatch(rankCandidates(shop, [right]))?.transactionId).toBe(right.id);
  });

  test('outgoing invoice pairs with incoming money, provider fees are tolerated', () => {
    const invoice = receipt({
      direction: 'outgoing',
      issuer: 'Beispiel Handel GmbH',
      invoiceNumber: 'RE-2026-0815',
      invoiceDate: '2026-09-01',
      dueDate: '2026-09-15',
      grossCents: 119000,
      dueCents: 119000,
      iban: 'DE89370400440532013000',
    });
    const paid = tx({
      bookingDate: '2026-09-23',
      amountCents: 119000,
      counterpartyName: 'Beispiel Handel GmbH',
      counterpartyIban: 'DE17100500000123456789',
      purpose: 'RE-2026-0815',
    });
    const viaStripe = tx({
      bookingDate: '2026-09-05',
      amountCents: 118650,
      counterpartyName: 'Stripe Payments Europe Ltd',
      counterpartyIban: null,
      purpose: 'STRIPE PAYOUT',
    });
    const bill = tx({ amountCents: -119000 });
    const candidates = rankCandidates(invoice, [paid, viaStripe, bill]);
    expect(candidates.map((c) => c.transactionId)).toEqual([paid.id, viaStripe.id]);
    expect(candidates[0]).toMatchObject({ amount: 'exact', reference: true, identity: 'name' });
    expect(candidates[1]).toMatchObject({ amount: 'fee', identity: null });
    expect(autoMatch(candidates)?.transactionId).toBe(paid.id);
  });

  test('date windows: far away is dropped, late is weak', () => {
    const old = receipt({ invoiceDate: '2026-05-01', dueDate: null });
    const tooLate = tx({ bookingDate: '2026-09-20' });
    const late = tx({ bookingDate: '2026-08-15' });
    const extended = tx({ bookingDate: '2026-07-10' });
    const candidates = rankCandidates(old, [tooLate, late, extended]);
    expect(candidates.map((c) => [c.transactionId, c.dateFit])).toEqual([
      [extended.id, 'extended'],
      [late.id, 'outside'],
    ]);
    expect(autoMatch(candidates)).toBeNull();
  });

  test('amount tolerance: near within 3 %, dropped beyond, other currency dropped', () => {
    const near = tx({ amountCents: -17600 });
    const far = tx({ amountCents: -18500 });
    const dollars = tx({ currency: 'USD' });
    const candidates = rankCandidates(receipt(), [near, far, dollars]);
    expect(candidates.map((c) => [c.transactionId, c.amount])).toEqual([[near.id, 'near']]);
  });

  test('numeric invoice numbers do not match inside other numbers', () => {
    const bill = receipt({ invoiceNumber: '12345', iban: null, issuer: null });
    const insideIban = tx({ counterpartyIban: null, purpose: 'Zahlung an DE45120300001234567890' });
    const real = tx({ counterpartyIban: null, purpose: 'Rechnung 12345' });
    const [first, second] = rankCandidates(bill, [insideIban, real]);
    expect(first).toMatchObject({ transactionId: real.id, reference: true });
    expect(second).toMatchObject({ transactionId: insideIban.id, reference: false });
  });

  test('receipt without an amount is kept only with a reference or strong identity', () => {
    const noAmount = receipt({ grossCents: null, dueCents: null, iban: null, issuer: null });
    const withReference = tx({ purpose: 'MS-10023', counterpartyIban: null });
    const unrelated = tx({ purpose: 'Miete', counterpartyIban: null });
    const candidates = rankCandidates(noAmount, [withReference, unrelated]);
    expect(candidates.map((c) => [c.transactionId, c.amount])).toEqual([
      [withReference.id, 'none'],
    ]);
    expect(autoMatch(candidates)).toBeNull();
  });

  test('maxCandidates', () => {
    const many = Array.from({ length: 20 }, () => tx());
    expect(rankCandidates(receipt(), many)).toHaveLength(10);
    expect(rankCandidates(receipt(), many, { maxCandidates: 3 })).toHaveLength(3);
  });
});

describe('names', () => {
  test.each([
    ['Muster Software GmbH', 'MUSTER SOFTWARE GMBH', 1],
    ['Amazon EU S.à r.l.', 'AMAZON EU SARL', 1],
    ['Telekom Deutschland GmbH', 'TELEKOMDEUTSCHLAND', 0.9],
    ['Mustermann Software Entwicklung GmbH', 'MUSTERMANN SOFTWARE ENTWICKL', 0.9],
    ['Stadtwerke Musterstadt GmbH', 'Stadtwerke Beispielstadt GmbH', 0],
  ])('%s ~ %s', (a, b, atLeast) => {
    const similarity = nameSimilarity(a, b);
    if (atLeast === 0) expect(similarity).toBeLessThan(0.8);
    else expect(similarity).toBeGreaterThanOrEqual(atLeast);
  });

  test('payment intermediaries', () => {
    expect(isPaymentIntermediary('PayPal (Europe) S.à r.l. et Cie, S.C.A.')).toBe(true);
    expect(isPaymentIntermediary('Klarna Bank AB')).toBe(true);
    expect(isPaymentIntermediary('Stripe Payments Europe Ltd')).toBe(true);
    expect(isPaymentIntermediary('Checkout.com')).toBe(true);
    expect(isPaymentIntermediary('Muster Shop GmbH')).toBe(false);
  });
});
