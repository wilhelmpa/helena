// Entirely fictional multipart mail; never replace with a private original.
export const receiptHtml = `
<html><body><p>Thank you for your transaction. Your items are now available.</p>
<p>Invoice: FICTION-92001</p><p>Date issued: 4 Sep, 2026</p>
<table><tr><td>Subtotal (excl. VAT):</td><td>20.00 EUR</td></tr>
<tr><td>VAT at 19%:</td><td>3.80 EUR</td></tr>
<tr><td>Total:</td><td>23.80 EUR</td></tr></table>
<p>This email message will serve as your receipt.</p>
<p><a href="https://example.invalid/receipt?key=fictional-secret">View receipt</a></p>
<img src="https://example.invalid/tracker">
</body></html>`;

export const plainStub =
  'Thank you for your transaction. View details at https://example.invalid/receipt?key=fictional-secret';
export const htmlMail = {
  subject: 'Thank you for your purchase!',
  fromName: 'Fictional Orchard Software',
  fromAddress: 'receipt@example.invalid',
  sentAt: new Date('2026-09-04T14:00:00Z'),
  textBody: plainStub,
  htmlBody: receiptHtml,
};

export function receiptMime(plain = plainStub, html = receiptHtml, id = 'fictional-receipt') {
  return Buffer.from(
    [
      'From: Fictional Orchard Software <receipt@example.invalid>',
      'To: Recipient <recipient@example.invalid>',
      'Subject: Thank you for your purchase!',
      'Date: Fri, 4 Sep 2026 14:00:00 +0000',
      `Message-ID: <${id}@example.invalid>`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="fictional-body"',
      '',
      '--fictional-body',
      'Content-Type: text/plain; charset=utf-8',
      '',
      plain,
      '--fictional-body',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      '--fictional-body--',
      '',
    ].join('\r\n'),
  );
}
