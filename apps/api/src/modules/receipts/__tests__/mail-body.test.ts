import { describe, expect, it } from 'bun:test';
import { parseMessage, sha256 } from '@repo/mail';
import { hasMailReceiptEvidence, mailReceiptFacts } from '../mail-facts';
import { htmlMail, plainStub, receiptHtml, receiptMime } from './fixtures/html-receipt';

describe('receipt-only MIME fallback', () => {
  it('reads an issued HTML receipt behind a plain stub without changing the parsed text or original', async () => {
    const raw = receiptMime();
    const original = Buffer.from(raw);
    const hash = sha256(raw);
    const parsed = await parseMessage(raw);
    expect(parsed.text.trim()).toBe(plainStub);
    const facts = mailReceiptFacts({ ...htmlMail, textBody: parsed.text, htmlBody: parsed.html });
    expect(facts).toMatchObject({
      invoiceNumber: 'FICTION-92001',
      invoiceDate: '2026-09-04',
      grossCents: 2380,
      vatCents: 380,
      currency: 'EUR',
      details: { mailBody: { part: 'text/html-fallback', fallback: 'accepted' } },
    });
    expect(hasMailReceiptEvidence(htmlMail.subject, facts)).toBe(true);
    expect(facts.textExcerpt).not.toContain('fictional-secret');
    expect(facts.textExcerpt).not.toContain('tracker');
    expect(raw.equals(original)).toBe(true);
    expect(sha256(raw)).toBe(hash);
  });

  it.each([
    ['Invoice number: PLAIN-33\nTotal: 12.00 EUR', 'plain-has-facts'],
    ['Invoice: PLAIN-33', 'plain-has-facts'],
    ['Order #PLAIN-33', 'plain-has-facts'],
    ['Transaction ID: PLAIN-33', 'plain-has-facts'],
    ['Total: 12.00', 'plain-has-facts'],
    ['You paid 12.00 USD', 'plain-has-facts'],
    ['Your payment is pending.', 'contradiction'],
    ['Your payment failed.', 'contradiction'],
    ['This invoice is not paid.', 'contradiction'],
    ['Your purchase was cancelled.', 'contradiction'],
    ['You will be charged tomorrow.', 'contradiction'],
    ['Der Betrag wird morgen belastet.', 'contradiction'],
  ] as const)('never overrides plain facts or contradicting status: %s', (textBody, reason) => {
    const facts = mailReceiptFacts({ ...htmlMail, textBody });
    expect(facts.details.mailBody).toEqual({ part: 'primary-text', fallback: reason });
    expect(facts.vatCents).not.toBe(380);
    expect(facts.invoiceNumber).not.toBe('FICTION-92001');
    expect(hasMailReceiptEvidence(htmlMail.subject, facts)).toBe(false);
  });

  it('keeps a complete plain invoice authoritative even when HTML disagrees', () => {
    const facts = mailReceiptFacts({
      ...htmlMail,
      subject: 'Invoice',
      textBody: 'Invoice number: PLAIN-33\nInvoice date: 2026-09-03\nTotal: 12.00 EUR',
    });
    expect(facts).toMatchObject({
      invoiceNumber: 'PLAIN-33',
      grossCents: 1200,
      vatCents: null,
      invoiceDate: '2026-09-03',
    });
    expect(facts.details.mailBody?.part).toBe('primary-text');
    expect(hasMailReceiptEvidence('Invoice', facts)).toBe(true);
  });

  it('binds invoice and total fields in separate columns without mixing neighbouring cells', () => {
    const htmlBody = receiptHtml.replace(
      '<p>Invoice: FICTION-92001</p><p>Date issued: 4 Sep, 2026</p>',
      `<table><tr><td>Invoice:</td><td>FICTION-92001</td><td>VAT at 19%:</td><td>3.80 EUR</td></tr><tr><td>Date issued:</td><td>4 Sep, 2026 @ 4:00pm CEST</td><td>Total:</td><td>23.80 EUR</td></tr></table>`,
    );
    const facts = mailReceiptFacts({ ...htmlMail, htmlBody });
    expect(facts).toMatchObject({
      invoiceNumber: 'FICTION-92001',
      invoiceDate: '2026-09-04',
      grossCents: 2380,
      vatCents: 380,
    });
    expect(facts.details.mailBody?.fallback).toBe('accepted');
  });

  it.each([
    '<p>Order #123</p><p>Total: 23.80 EUR</p><p>Payment: Visa</p>',
    '<p>We send invoices and receipts. View yours online.</p>',
    receiptHtml.replace('Invoice: FICTION-92001', 'Order: FICTION-92001'),
    receiptHtml.replace('Date issued: 4 Sep, 2026', 'Delivery date: 4 Sep, 2026'),
    receiptHtml.replace('This email message will serve as your receipt.', 'Payment method: card'),
    receiptHtml.replace(
      'This email message will serve as your receipt.',
      'You will be charged tomorrow.',
    ),
    receiptHtml.replace('Total:', 'Estimated total:'),
    receiptHtml.replace('23.80 EUR', 'not available'),
    receiptHtml.replace('</body>', '<p>Total: 31.00 EUR</p></body>'),
    receiptHtml.replace('</body>', '<p>Invoice: OTHER-22</p></body>'),
    receiptHtml.replace('</body>', '<p>Total: 23.80 USD</p></body>'),
    receiptHtml.replace('</body>', '<p>Amount paid: 12.00 EUR</p></body>'),
    receiptHtml.replace('</body>', '<p>Amount paid: 23.80 USD</p></body>'),
    receiptHtml.replace('</body>', '<p>Date issued: 5 Sep, 2026</p></body>'),
    receiptHtml.replace('</body>', '<p>Total: pending</p></body>'),
    receiptHtml.replace('</body>', '<p>Invoice: pending</p></body>'),
    receiptHtml.replace('3.80 EUR', '93.80 EUR'),
  ])('leaves incomplete, ambiguous or non-receipt HTML unselected', (htmlBody) => {
    const facts = mailReceiptFacts({ ...htmlMail, htmlBody });
    expect(facts.details.mailBody).toEqual({ part: 'primary-text', fallback: 'incomplete-html' });
    expect(facts.grossCents).toBeNull();
    expect(hasMailReceiptEvidence(htmlMail.subject, facts)).toBe(false);
  });

  it.each([
    'hidden',
    'aria-hidden="true"',
    'style="display:none"',
    'style="visibility:hidden"',
    'style="opacity:0"',
    'style="font-size:0px"',
  ])('does not mine hidden receipt content: %s', async (attribute) => {
    const parsed = await parseMessage(
      receiptMime(plainStub, `<div ${attribute}>${receiptHtml}</div>`),
    );
    const facts = mailReceiptFacts({ ...htmlMail, textBody: parsed.text, htmlBody: parsed.html });
    expect(facts.grossCents).toBeNull();
    expect(hasMailReceiptEvidence(htmlMail.subject, facts)).toBe(false);
  });

  it('does not treat a second payment original as a source of invoice fields', () => {
    const payment = mailReceiptFacts({
      ...htmlMail,
      htmlBody: null,
      subject: 'Payment receipt',
      textBody: 'Amount paid: 23.80 EUR\nTransaction ID: PAY-42',
    });
    const invoice = mailReceiptFacts(htmlMail);
    expect(payment.vatCents).toBeNull();
    expect(payment.invoiceNumber).not.toBe(invoice.invoiceNumber);
    expect(invoice.vatCents).toBe(380);
    expect(sha256(receiptMime())).not.toBe(
      sha256(receiptMime(payment.textExcerpt!, '', 'fictional-payment')),
    );
  });
});
