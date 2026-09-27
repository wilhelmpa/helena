import { factsFromText, parseAmountCents } from '@helena/finance';
import type { ExtractedReceipt } from './extract';

export const receiptFilename = (name: string) =>
  /rechnung|invoice|receipt|quittung|beleg|gutschrift|storno|mahnung|(?:^|[-_ ])(?:RE|MA)-\d/i.test(
    name,
  );

export const unrelatedFilename = (name: string) =>
  /vertrag|contract|agreement|angebot|offer|enrollment|anmeldung|screenshot|konfiguration|configuration/i.test(
    name,
  );

export function mailReceiptFacts(
  mail: { subject: string; textBody: string; fromName: string; fromAddress: string; sentAt: Date },
  ownIbans: string[] = [],
): ExtractedReceipt {
  const text = mail.textBody.replace(/<[^>]*>/g, '').replace(/\u00a0/g, ' ');
  const facts = factsFromText(text, ownIbans);
  const paid =
    /(?:Sie haben|Rückzahlung insgesamt|Gesamter Rückerstattungsbetrag|Geld erhalten|BEZAHLTER BETRAG|Amount paid|Total charge|Gesamt bezahlt)\s*:?\s*[$€]?\s*([\d.,]+)(?:\s*€)?\s*(?:EUR|USD)?/i.exec(
      text,
    );
  const appleTotal = /(?:^|\n)\s*PayPal\s+([\d.,]+)\s*€/i.exec(text);
  const settledPayment =
    /Ihre Zahlung in Höhe von\s+([\d.,]+)\s*(?:€(?:\s*EUR)?|EUR)\s+wurde am\s+([^\n]{1,160})\s+verrechnet[.!]?(?:\s|$)/i.exec(
      text,
    );
  const paidAmount =
    paid?.[1] ??
    (settledPayment && !/\bnicht\b/i.test(settledPayment[2]!) ? settledPayment[1] : null);
  const transaction = /Transaktionscode\s*(?:Transaktionsdatum\s*)?([A-Z0-9]{10,30})/i.exec(
    text,
  )?.[1];
  const number =
    /(?:Invoice ID|Receipt #|Rechnung\s*:|Beleg)\s*([A-Z0-9][A-Z0-9_-]*\d[A-Z0-9_-]*)/i.exec(
      text,
    )?.[1];
  const purchase = /confirmed your purchase of\s*\$([\d.,]+)/i.exec(text)?.[1];
  const refund = /rück(?:zahlung|erstattung)|refund|gutschrift|credit note/i.test(mail.subject);
  const received = /has sent you money|hat Ihnen.+gesendet|Zahlungsavis/i.test(
    mail.subject + '\n' + text.slice(0, 500),
  );
  const linkedOriginal = /invoice is available|rechnung.+liegt bereit/i.test(mail.subject);
  return {
    ...facts,
    issuer: mail.fromName || facts.issuer || mail.fromAddress,
    invoiceNumber: facts.invoiceNumber ?? transaction ?? number ?? null,
    invoiceDate: (refund ? null : facts.invoiceDate) ?? mail.sentAt.toISOString().slice(0, 10),
    grossCents: paidAmount
      ? parseAmountCents(paidAmount, 'auto')
      : (facts.grossCents ??
        (appleTotal?.[1]
          ? parseAmountCents(appleTotal[1], 'auto')
          : purchase
            ? parseAmountCents(purchase, 'auto')
            : null)),
    direction: received ? 'outgoing' : (facts.direction ?? 'incoming'),
    extraction: 'text',
    extractionError: linkedOriginal
      ? 'The original invoice is linked in this email but was not attached.'
      : null,
    textExcerpt: text.slice(0, 2000),
    details: {
      creditNote: refund || facts.creditNote,
      directDebit: facts.directDebit,
      paymentReference: transaction ?? null,
    },
  };
}

export function hasMailReceiptEvidence(subject: string, facts: ExtractedReceipt): boolean {
  const text = facts.textExcerpt ?? '';
  const document =
    /rechnung|invoice|facture|receipt|beleg|quittung|justificatif d[’'](?:achat|paiement)|re[cç]u(?: de)? (?:paiement|achat)/i;
  const upcoming =
    /\b(?:upcoming|coming up|will be charged|next (?:subscription )?(?:order|payment|charge)|prochain|prochaine|sera d[eé]bit[eé]|bevorstehend|demn[aä]chst)\b/i;
  const issuedInvoice =
    facts.invoiceNumber !== null &&
    /\b(?:invoice|rechnung|facture)\b/i.test(subject) &&
    /(?:invoice\s*(?:id|number|no\.?|#)|rechnungs?[- ]?(?:nummer|nr\.?)|facture\s*(?:n[°o]|num[eé]ro))/i.test(
      text,
    );
  const completedPurchase =
    /purchase confirmed/i.test(subject) &&
    /confirmed your purchase of\s*\$([\d.,]+)\s+with\b[\s\S]{0,160}\bcard\b/i.exec(text);
  if (
    /\b(?:order export|exportbericht|export report)\b/i.test(subject) ||
    (!issuedInvoice && upcoming.test(subject)) ||
    (!document.test(subject) && upcoming.test(text))
  )
    return false;
  if (completedPurchase && parseAmountCents(completedPurchase[1]!, 'auto') === facts.grossCents)
    return facts.grossCents !== null;
  return (
    facts.grossCents !== null &&
    (facts.invoiceNumber !== null ||
      /zahlung|payment|refund|rückerstatt|receipt|quittung|kaufbeleg|justificatif d[’'](?:achat|paiement)|re[cç]u(?: de)? (?:paiement|achat)|sent you money|zahlungsavis/i.test(
        subject,
      )) &&
    /rechnung|invoice|facture|receipt|beleg|quittung|justificatif d[’'](?:achat|paiement)|re[cç]u(?: de)? (?:paiement|achat)|zahlung|payment|refund|rückerstatt|sent you money|zahlungsavis/i.test(
      subject,
    )
  );
}
