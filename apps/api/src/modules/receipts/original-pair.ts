import { parseAmountCents } from '@helena/finance';

/** Evidence from complete native PDF text, never filenames, summaries or stored corrections. */
export interface OriginalDocumentEvidence {
  role: 'invoice' | 'receipt';
  invoiceNumber: string;
  grossCents: number;
  currency: string;
}

export interface OriginalPairEvidence {
  invoiceSha256: string;
  receiptSha256: string;
  invoiceNumber: string;
  grossCents: number;
  currency: string;
}

const MONEY = /^(?:(EUR|USD|GBP|CHF|€|US\$)\s*)?(\d+(?:[.,]\d{2})?)\s*(EUR|USD|GBP|CHF|€|US\$)?$/;
const currencyOf = (value: string) => (value === '€' ? 'EUR' : value === 'US$' ? 'USD' : value);

function printedMoney(value: string) {
  const match = MONEY.exec(value);
  if (!match || (!match[1] && !match[3])) return null;
  const currencies = [match[1], match[3]].filter((v): v is string => !!v).map(currencyOf);
  if (new Set(currencies).size !== 1) return null;
  const cents = parseAmountCents(match[2]!, 'auto');
  return cents === null ? null : { grossCents: cents, currency: currencies[0]! };
}

export function originalDocumentEvidence(text: string): OriginalDocumentEvidence | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // These explicit negative roles/statuses must not be interpreted as completed originals.
  if (
    /\b(?:draft|pro[ -]?forma|credit note|refund|cancelled|canceled|order confirmation|partial payment|payment (?:failed|pending|declined))\b|entwurf|gutschrift|storno|teilzahlung/i.test(
      text,
    )
  )
    return null;
  const roles = lines.filter((line) =>
    /^(?:invoice|rechnung|receipt|quittung|zahlungsbestätigung)$/i.test(line),
  );
  if (roles.length !== 1 || !lines.slice(0, 12).includes(roles[0]!)) return null;
  const role = /^(?:invoice|rechnung)$/i.test(roles[0]!) ? 'invoice' : 'receipt';
  if (
    role === 'receipt' &&
    /\b(?:upcoming|will be charged|awaiting payment|not paid|unpaid|payment due|pending|declined|unsuccessful|reversed|processing|failed)\b|noch nicht bezahlt|wird abgebucht|fehlgeschlagen|ausstehend/i.test(
      text,
    )
  )
    return null;
  const references = lines.filter((line) =>
    /^(?:invoice (?:number|no\.?|#)|rechnungsnummer|rechnungsnr\.?)(?=\s|:|$)/i.test(line),
  );
  const numbers = references.map(
    (line) =>
      /^(?:invoice (?:number|no\.?|#)|rechnungsnummer|rechnungsnr\.?)\s*:?\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,98}[A-Za-z0-9])$/i.exec(
        line,
      )?.[1] ?? null,
  );
  if (!numbers.length || numbers.some((number) => !number) || new Set(numbers).size !== 1)
    return null;
  const totals = lines.filter((line) =>
    /^(?:total|gesamtbetrag|rechnungsbetrag)\s*:?(?:\s|$)/i.test(line),
  );
  const paid = lines.filter((line) => /^(?:amount paid|bezahlter betrag)\s*:?(?:\s|$)/i.test(line));
  const amounts = (role === 'invoice' ? totals : paid).map((line) =>
    printedMoney(
      line.replace(
        /^(?:total|gesamtbetrag|rechnungsbetrag|amount paid|bezahlter betrag)\s*:?\s*/i,
        '',
      ),
    ),
  );
  if (!amounts.length || amounts.some((amount) => !amount)) return null;
  const amount = amounts[0]!;
  if (
    amounts.some(
      (other) => other?.grossCents !== amount.grossCents || other.currency !== amount.currency,
    )
  )
    return null;
  const printedCurrencies = [...text.matchAll(/\b(?:EUR|USD|GBP|CHF)\b|€|US\$/g)].map((match) =>
    currencyOf(match[0]),
  );
  if (printedCurrencies.some((currency) => currency !== amount.currency)) return null;
  for (const line of lines.filter((value) =>
    /^(?:invoice currency|currency|währung)\s*:/i.test(value),
  )) {
    const declared = /^(?:invoice currency|currency|währung)\s*:\s*([A-Z]{3})$/i.exec(line)?.[1];
    if (declared?.toUpperCase() !== amount.currency) return null;
  }
  // A receipt's printed Total, if present, must agree with its completed paid amount.
  for (const line of role === 'receipt' ? totals : []) {
    const total = printedMoney(
      line.replace(/^(?:total|gesamtbetrag|rechnungsbetrag)\s*:?\s*/i, ''),
    );
    if (!total || total.grossCents !== amount.grossCents || total.currency !== amount.currency)
      return null;
  }
  // Any explicitly printed remaining balance must be zero, even when another
  // line calls an earlier installment "Amount paid".
  if (role === 'receipt')
    for (const line of lines.filter((value) =>
      /^(?:amount due|balance due|remaining balance|restbetrag)\s*:?(?:\s|$)/i.test(value),
    )) {
      const due = printedMoney(
        line.replace(/^(?:amount due|balance due|remaining balance|restbetrag)\s*:?\s*/i, ''),
      );
      if (!due || due.grossCents !== 0 || due.currency !== amount.currency) return null;
    }
  // Zero is not proof of a completed payment; zero invoices remain ordinary originals.
  if (amount.grossCents <= 0) return null;
  return { role, invoiceNumber: numbers[0]!, ...amount };
}

interface PairPlan {
  attachmentId: number | null;
  filename: string;
  contentType: string;
  sha256: string;
  existingId: number | null;
  facts: {
    issuer: string | null;
    invoiceNumber: string | null;
    grossCents: number | null;
    currency: string | null;
    extractionError: string | null;
    originalEvidence?: OriginalDocumentEvidence | null;
    details: {
      mailSource?: { messageId: number; threadId: number; kind: string };
      creditNote?: boolean;
    };
  };
}

/** Both original IDs must also be newly inserted before applying this proposal. */
export function mailOriginalPair(plans: PairPlan[]): OriginalPairEvidence | null {
  if (plans.length !== 2 || plans[0]!.sha256 === plans[1]!.sha256) return null;
  if (
    plans.some(
      (plan) =>
        plan.attachmentId === null ||
        !/\.pdf$/i.test(plan.filename) ||
        plan.contentType !== 'application/pdf' ||
        plan.facts.extractionError ||
        plan.facts.details.creditNote,
    )
  )
    return null;
  const sources = plans.map((plan) => plan.facts.details.mailSource);
  if (
    sources.some((source) => !source || source.kind !== 'attachment') ||
    sources[0]!.messageId !== sources[1]!.messageId ||
    sources[0]!.threadId !== sources[1]!.threadId
  )
    return null;
  const invoice = plans.find((plan) => plan.facts.originalEvidence?.role === 'invoice');
  const receipt = plans.find((plan) => plan.facts.originalEvidence?.role === 'receipt');
  if (!invoice || !receipt) return null;
  // A shared reference is not globally unique. Reject a contradictory fresh issuer;
  // never infer company equivalence or use issuer similarity as positive evidence.
  if (
    invoice.facts.issuer !== null &&
    receipt.facts.issuer !== null &&
    invoice.facts.issuer !== receipt.facts.issuer
  )
    return null;
  const a = invoice.facts.originalEvidence!;
  const b = receipt.facts.originalEvidence!;
  if (
    a.invoiceNumber !== b.invoiceNumber ||
    a.grossCents !== b.grossCents ||
    a.currency !== b.currency
  )
    return null;
  if (
    plans.some(
      (plan) =>
        plan.facts.invoiceNumber !== a.invoiceNumber ||
        plan.facts.grossCents !== a.grossCents ||
        plan.facts.currency !== a.currency,
    )
  )
    return null;
  return {
    invoiceSha256: invoice.sha256,
    receiptSha256: receipt.sha256,
    invoiceNumber: a.invoiceNumber,
    grossCents: a.grossCents,
    currency: a.currency,
  };
}
