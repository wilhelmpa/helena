import { factsFromText, parseAmountCents } from '@helena/finance';
import { receiptHtmlText } from '@repo/mail';

export type MailBodyProvenance = {
  // Parsed/stored text can itself come from an HTML-only mail. Do not claim an
  // original text/plain MIME part when the parser did not expose that distinction.
  part: 'primary-text' | 'text/html-fallback';
  fallback: 'not-needed' | 'plain-has-facts' | 'contradiction' | 'incomplete-html' | 'accepted';
};

// These are refusal signals, not evidence of a completed charge. Strip link targets
// before testing the plain stub so opaque URL tokens cannot become financial facts.
const CONTRADICTION =
  /\b(?:upcoming|will (?:be (?:charged|debited)|charge|debit)|not (?:paid|charged|completed|a (?:receipt|invoice))|unpaid|cancelled|canceled|void|draft|payment (?:is )?(?:failed|pending|scheduled)|next (?:subscription )?(?:payment|charge|order)|order export|export report|nicht (?:bezahlt|belastet)|wird\b[^\n]{0,80}\b(?:belastet|verrechnet|abgebucht)|storniert|entwurf|sera d[eé]bit[eé])\b/i;
const IDENTITY =
  /\b(?:invoice|receipt|rechnung|beleg|facture|order|bestell|transaction|payment|reference)(?:\s*(?:number|no\.?|id|nr\.?|nummer|code))?\s*[:#]\s*\S|\b(?:EUR|USD|GBP|CHF)\s*\d|\d\s*(?:EUR|USD|GBP|CHF)\b|[$€£]\s*\d|\d\s*[$€£]/i;

function cleanPlain(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\u00a0/g, ' ');
}

function currencyOf(value: string): string {
  return { '€': 'EUR', $: 'USD', '£': 'GBP' }[value] ?? value.toUpperCase();
}

function issuedReceipt(text: string) {
  if (CONTRADICTION.test(text)) return null;
  if (
    !/\b(?:this (?:e-?mail(?: message)?|message) (?:will )?serve[sd]? as your receipt|payment (?:received|completed|confirmed)|paid in full)\b/i.test(
      text,
    )
  )
    return null;
  // htmlText preserves table columns with padding. Treat each cell as a field;
  // never let a neighbouring VAT/total column become part of an invoice id.
  const cells = text
    .split(/\r?\n|[ \t]{2,}/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = cells.map((cell, index) =>
    cell.endsWith(':') ? `${cell} ${cells[index + 1] ?? ''}` : cell,
  );
  // A bare Invoice: label is accepted here only inside a complete issued receipt.
  const numberLines = lines.filter((line) =>
    /^(?:invoice|receipt)\s*(?:(?:number|no\.?|id|#)\s*)?:/i.test(line),
  );
  const numbers = numberLines.flatMap((line) => {
    const match =
      /^(?:invoice|receipt)\s*(?:(?:number|no\.?|id|#)\s*)?:\s*([A-Z0-9][A-Z0-9/_-]*)\s*$/i.exec(
        line,
      );
    return match?.[1] && /\d/.test(match[1]) ? [match[1]] : [];
  });
  const dates = lines.filter((line) =>
    /^(?:date issued|invoice date|date of issue)\s*:/i.test(line),
  );
  const totalLines = lines.filter((line) =>
    /^(?:grand total|total(?: (?:paid|incl\.? (?:VAT|tax)))?)\s*:/i.test(line),
  );
  const totals = totalLines.flatMap((line) => {
    const match =
      /^(?:grand total|total(?: (?:paid|incl\.? (?:VAT|tax)))?)\s*:\s*([$€£])?\s*(\d+(?:[.,]\d{2}))\s*(€|\$|£|EUR|USD|GBP|CHF)?\s*$/i.exec(
        line,
      );
    if (!match || (!match[1] && !match[3])) return [];
    const cents = parseAmountCents(match[2]!, 'auto');
    if (match[1] && match[3] && currencyOf(match[1]) !== currencyOf(match[3])) return [];
    return cents === null ? [] : [{ cents, currency: currencyOf(match[3] ?? match[1]!) }];
  });
  const facts = factsFromText(text);
  if (
    !numbers.length ||
    numbers.length !== numberLines.length ||
    new Set(numbers).size !== 1 ||
    !dates.length ||
    !totals.length ||
    totals.length !== totalLines.length ||
    new Set(totals.map((total) => `${total.currency}:${total.cents}`)).size !== 1
  )
    return null;
  const dateFacts = dates.map(
    (line) => factsFromText(line.replace(/([a-z]+),\s+(?=\d{4})/i, '$1 ')).invoiceDate,
  );
  const total = totals[0]!;
  if (facts.vatCents !== null && (facts.vatCents < 0 || facts.vatCents > total.cents)) return null;
  if (
    dateFacts.some((date) => !date) ||
    new Set(dateFacts).size !== 1 ||
    (facts.invoiceDate !== null && facts.invoiceDate !== dateFacts[0]) ||
    facts.grossCents !== total.cents ||
    facts.currency !== total.currency
  )
    return null;
  // A receipt total and an explicitly paid amount must not silently disagree.
  for (const line of lines.filter((line) =>
    /^(?:amount paid|total charge|gesamt bezahlt)\s*:/i.test(line),
  )) {
    const paid = /:\s*([$€£])?\s*(\d+[.,]\d{2})\s*(€|\$|£|EUR|USD|GBP|CHF)?\s*$/i.exec(line);
    if (!paid || parseAmountCents(paid[2]!, 'auto') !== total.cents) return null;
    if (
      (paid[1] && currencyOf(paid[1]) !== total.currency) ||
      (paid[3] && currencyOf(paid[3]) !== total.currency)
    )
      return null;
  }
  return { invoiceNumber: numbers[0]!, invoiceDate: dateFacts[0]!, grossCents: total.cents };
}

/** Select one MIME alternative; never combine fields from both alternatives. */
export function selectReceiptBody(mail: {
  subject: string;
  textBody: string;
  htmlBody?: string | null;
}) {
  const plain = cleanPlain(mail.textBody);
  const provenance: MailBodyProvenance = { part: 'primary-text', fallback: 'not-needed' };
  const original = {
    text: mail.textBody,
    provenance,
    issued: null as ReturnType<typeof issuedReceipt>,
  };
  if (!mail.htmlBody) return original;
  if (
    CONTRADICTION.test(`${mail.subject}\n${plain}`) ||
    /\b(?:refund|rückzahlung|gutschrift|credit note)\b/i.test(mail.subject)
  ) {
    provenance.fallback = 'contradiction';
    return original;
  }
  const facts = factsFromText(plain);
  if (
    IDENTITY.test(plain) ||
    facts.grossCents !== null ||
    facts.vatCents !== null ||
    facts.invoiceNumber !== null ||
    facts.iban !== null
  ) {
    provenance.fallback = 'plain-has-facts';
    return original;
  }
  const html = receiptHtmlText(mail.htmlBody);
  const issued = html === null ? null : issuedReceipt(html);
  if (!issued || html === null) {
    provenance.fallback = 'incomplete-html';
    return original;
  }
  return {
    text: html,
    provenance: { part: 'text/html-fallback', fallback: 'accepted' } as MailBodyProvenance,
    issued,
  };
}
