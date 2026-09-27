import { expect, it } from 'bun:test';
import { mailOriginalPair, originalDocumentEvidence } from '../original-pair';
import { assertReviewedMailSource } from '../mail-review';

const invoice = 'Invoice\nInvoice number: INV-42\nTotal: 23.80 EUR';
const receipt = 'Receipt\nInvoice number: INV-42\nTotal: 23.80 EUR\nAmount paid: 23.80 EUR';

function plan(text: string, id: number) {
  const originalEvidence = originalDocumentEvidence(text);
  return {
    attachmentId: id,
    filename: `document-${id}.pdf`,
    contentType: 'application/pdf',
    sha256: String(id).repeat(64),
    size: 100,
    existingId: null as number | null,
    facts: {
      issuer: 'Fictional Seller' as string | null,
      invoiceNumber: originalEvidence?.invoiceNumber ?? null,
      grossCents: originalEvidence?.grossCents ?? null,
      currency: originalEvidence?.currency ?? null,
      extractionError: null as string | null,
      originalEvidence,
      details: {
        mailSource: { messageId: 10, threadId: 20, kind: 'attachment' },
        creditNote: false,
      },
    },
  };
}

it('proves roles and explicit shared invoice reference, amount and currency; order does not matter', () => {
  const a = plan(invoice, 1);
  const b = plan(receipt, 2);
  expect(mailOriginalPair([a, b])).toEqual({
    invoiceSha256: a.sha256,
    receiptSha256: b.sha256,
    invoiceNumber: 'INV-42',
    grossCents: 2380,
    currency: 'EUR',
  });
  expect(mailOriginalPair([b, a])).toEqual(mailOriginalPair([a, b]));
  // Evidence stays comparable on replay, but application separately requires two new inserts.
  a.existingId = 99;
  expect(mailOriginalPair([a, b])).toEqual(mailOriginalPair([b, a]));
});

for (const [name, text] of [
  ['ordinary order', receipt.replace('Receipt', 'Order confirmation')],
  ['draft', `${receipt}\nDraft`],
  ['future payment', `${receipt}\nWill be charged tomorrow`],
  ['failed payment', `${receipt}\nPayment failed`],
  ['pending status label', `${receipt}\nPayment status: Pending`],
  ['failed status label', `${receipt}\nPayment status: Failed`],
  ['unpaid', `${receipt}\nNot paid`],
  ['partial payment', `${receipt}\nPartial payment`],
  ['credit note', `${receipt}\nCredit note`],
  ['refund', `${receipt}\nRefund`],
  ['ambiguous roles', `${receipt}\nInvoice`],
  ['two invoice references', `${receipt}\nInvoice number: INV-43`],
  ['conflicting hash-label reference', `${receipt}\nInvoice #: INV-43`],
  ['remaining balance', `${receipt}\nBalance due: 1.00 EUR`],
  ['different declared currency', `${receipt}\nCurrency: USD`],
  ['conversion ambiguity', `${receipt}\nConverted total: 25.00 USD`],
  ['order reference only', receipt.replace('Invoice number', 'Order number')],
  ['receipt reference only', receipt.replace('Invoice number', 'Receipt number')],
  ['no completed payment', receipt.replace('Amount paid', 'Amount due')],
  ['partial amount', receipt.replace('Amount paid: 23.80', 'Amount paid: 12.00')],
  ['ambiguous currency symbol', receipt.replaceAll('23.80 EUR', '$23.80')],
  [
    'conflicting currencies',
    receipt.replace('Amount paid: 23.80 EUR', 'Amount paid: USD 23.80 EUR'),
  ],
  ['zero payment', receipt.replaceAll('23.80', '0.00')],
  ['negative payment', receipt.replaceAll('23.80', '-23.80')],
])
  it(`does not group ${name}`, () =>
    expect(mailOriginalPair([plan(invoice, 1), plan(text!, 2)])).toBeNull());

it('keeps independent invoices, different references/currencies/amounts and more than two originals separate', () => {
  expect(mailOriginalPair([plan(invoice, 1), plan(invoice, 2)])).toBeNull();
  for (const text of [
    receipt.replaceAll('INV-42', 'INV-43'),
    receipt.replaceAll('EUR', 'USD'),
    receipt.replaceAll('23.80', '24.80'),
  ])
    expect(mailOriginalPair([plan(invoice, 1), plan(text, 2)])).toBeNull();
  expect(mailOriginalPair([plan(invoice, 1), plan(receipt, 2), plan(invoice, 3)])).toBeNull();
});

it('rejects contradictory fresh issuers even when the mail, invoice reference and amount agree', () => {
  const a = plan(invoice, 1);
  const b = plan(receipt, 2);
  a.facts.issuer = 'Alpha Example GmbH';
  b.facts.issuer = 'Beta Example GmbH';
  expect(mailOriginalPair([a, b])).toBeNull();
  b.facts.issuer = 'Alpha Example GmbH';
  expect(mailOriginalPair([a, b])).not.toBeNull();
  b.facts.issuer = 'Alpha Example GmbH (billing)';
  expect(mailOriginalPair([a, b])).toBeNull();
});

it('requires the same source mail and fresh native-text evidence, never a filename or corrected field', () => {
  for (const change of [
    (p: ReturnType<typeof plan>) => {
      p.facts.details.mailSource.messageId++;
    },
    (p: ReturnType<typeof plan>) => {
      p.facts.details.mailSource.threadId++;
    },
    (p: ReturnType<typeof plan>) => {
      p.facts.details.mailSource.kind = 'body';
    },
    (p: ReturnType<typeof plan>) => {
      p.facts.originalEvidence = null;
    },
    (p: ReturnType<typeof plan>) => {
      p.facts.grossCents = 1;
    },
    (p: ReturnType<typeof plan>) => {
      p.facts.extractionError = 'incomplete';
    },
    (p: ReturnType<typeof plan>) => {
      p.contentType = 'text/plain';
    },
    (p: ReturnType<typeof plan>) => {
      p.sha256 = '1'.repeat(64);
    },
  ]) {
    const b = plan(receipt, 2);
    change(b);
    expect(mailOriginalPair([plan(invoice, 1), b])).toBeNull();
  }
});

it('binds a reviewed pair to its exact original SHAs and refuses an older review without the new proof', () => {
  const plans = [plan(invoice, 1), plan(receipt, 2)];
  const source = {
    accountId: 1,
    threadId: 20,
    originals: plans,
    originalPair: mailOriginalPair(plans),
  };
  expect(() => assertReviewedMailSource(source, source)).not.toThrow();
  expect(() => assertReviewedMailSource({ ...source, originalPair: null }, source)).toThrow();
  expect(() =>
    assertReviewedMailSource(source, {
      ...source,
      originalPair: { ...source.originalPair!, receiptSha256: '3'.repeat(64) },
    }),
  ).toThrow();
});
