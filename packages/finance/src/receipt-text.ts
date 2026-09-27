import { addDays, findIbans, normalizeIban, parseAmountCents, parseDateAny } from './money';

/**
 * Facts guessed from the plain text of a receipt or invoice (pdftotext or OCR output) when no
 * e-invoice XML is embedded. Every field is a heuristic; null means "not found", not "absent".
 */
export interface TextFacts {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  grossCents: number | null;
  vatCents: number | null;
  currency: string | null;
  iban: string | null;
  issuer: string | null;
  /** The document calls itself a credit note (Gutschrift, Stornorechnung). */
  creditNote: boolean;
  /** The amount is collected by SEPA direct debit (Lastschrift, abgebucht, Mandat). */
  directDebit: boolean;
  /**
   * Direction hint: 'incoming' for a bill to pay (a foreign IBAN to pay to, or a direct debit),
   * 'outgoing' for an invoice we issued (only our own IBAN is printed as payment account).
   */
  direction: 'incoming' | 'outgoing' | null;
}

/** Money tokens: German "1.234,56" / "12,50" or English "1,234.56" / "12.50", never a date. */
const MONEY =
  /(?<![\d.,])-?(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?!\d|[.,]\d)(?!\s?%)/g;
const DATE_TOKEN =
  /\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\.?\s+(?:jan|feb|mär|maer|mar|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|dez|dec)[a-zä]*\.?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i;

const STRONG_GROSS =
  /gesamtbetrag|rechnungsbetrag|rechnungssumme|endbetrag|endsumme|summe brutto|bruttobetrag|bruttosumme|gesamtsumme|gesamt brutto|zu zahlen|zahlbetrag|amount due|total due|grand total|balance due/i;
const WEAK_GROSS = /\b(total|gesamt|summe|betrag)\b/i;
const NET = /netto|zwischensumme|sub-?total|exkl|excl|zzgl|ohne mwst/i;
const GROSS_HINT = /brutto|inkl|incl/i;
const VAT = /mwst|mw\.-?st|\bust\b|\bust\.|umsatzsteuer|mehrwertsteuer|\bvat\b|\btax\b/i;
/** Receipt tax tables: "A= 19,0% 5,87 1,12 6,99" (class, rate, net, VAT, gross). */
const TAX_CLASS = /^[A-D]\s*[=:]?\s*\d{1,2}(?:[.,]\d{1,2})?\s?%/;
const TAX_ID =
  /ust-?id|ust\.?-?idnr|steuer-?nr|steuernummer|vat (?:id|no|number|reg)|tax (?:id|no|number)/i;

function amountsOn(line: string): number[] {
  return [...line.matchAll(MONEY)]
    .map((m) => parseAmountCents(m[0], 'auto'))
    .filter((c): c is number => c !== null);
}

function dateIn(text: string): string | null {
  const m = DATE_TOKEN.exec(text);
  return m ? parseDateAny(m[0].replace(/(\d\.)\s(?=\d)/g, '$1')) : null;
}

function frenchTotals(lines: string[]): { gross: number | null; vat: number | null } | null {
  const candidates = lines.filter((line) =>
    /^(?:prix|montant(?: total)?|total)\s+TTC\b/i.test(line),
  );
  if (!candidates.length) return null;
  const totals = candidates.map((line) => {
    const match =
      /^(?:prix|montant(?: total)?|total)\s+TTC\s*:?\s*(\d+(?:[.,]\d{2})?)\s*(?:euros?\b|EUR\b|€)(?:\s+dont\s+(\d+(?:[.,]\d{2})?)\s*(?:euros?\b|EUR\b|€)\s+(?:de\s+)?TVA)?\s*[.;]?$/i.exec(
        line,
      );
    if (!match) return null;
    const gross = parseAmountCents(match[1]!, 'auto');
    const vat = match[2] ? parseAmountCents(match[2], 'auto') : null;
    if (gross === null || (vat !== null && vat > gross)) return null;
    return { gross, vat };
  });
  const first = totals[0];
  return first && totals.every((total) => total?.gross === first.gross && total.vat === first.vat)
    ? first
    : { gross: null, vat: null };
}

export function factsFromText(text: string, ownIbans: string[] = []): TextFacts {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean);
  const invoiceDate = findInvoiceDate(lines);
  const french = frenchTotals(lines);
  const own = new Set(ownIbans.map((i) => normalizeIban(i)).filter((i): i is string => i !== null));
  const ibans = findIbans(text);
  const foreign = ibans.find((i) => !own.has(i)) ?? null;
  const ownPrinted = ibans.some((i) => own.has(i));
  const directDebit =
    /lastschrift|abgebucht|eingezogen|bankeinzug|sepa-mandat|mandatsreferenz|direct debit|abbuchung/i.test(
      text,
    );
  let direction: TextFacts['direction'] = null;
  if (directDebit || foreign) direction = 'incoming';
  else if (ownPrinted) direction = 'outgoing';
  return {
    invoiceNumber: findInvoiceNumber(lines),
    invoiceDate,
    dueDate: findDueDate(lines, invoiceDate),
    grossCents: french ? french.gross : findGross(lines),
    vatCents: findVat(lines) ?? french?.vat ?? null,
    currency: findCurrency(lines),
    iban: foreign,
    issuer: findIssuer(lines),
    creditNote: lines
      .slice(0, 15)
      .some((l) => /\b(gutschrift|credit note|stornorechnung|rechnungskorrektur)\b/i.test(l)),
    directDebit,
    direction,
  };
}

const STRONG_NUMBER =
  /(?:rechnungs?[- ]?(?:nummer|nr\.?|no\.?)|rechnung\s+(?:nr\.?|nummer|no\.?)|beleg[- ]?(?:nummer|nr\.?)|invoice\s*(?:no\.?|number|nr\.?|#)|quittungs?[- ]?(?:nummer|nr\.?)|bon[- ]?(?:nummer|nr\.?)|gutschrifts?[- ]?(?:nummer|nr\.?))\s*[:#.]?\s*/i;
const WEAK_NUMBER =
  /(?:bestell[- ]?(?:nummer|nr\.?)|order\s*(?:no\.?|number|#)|auftrags?[- ]?(?:nummer|nr\.?))\s*[:#.]?\s*/i;
const NUMBER_VALUE = /^([A-Z0-9][A-Z0-9\-/._]*[A-Z0-9]|[0-9])/i;

function numberAfter(label: RegExp, lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = label.exec(line);
    if (!m) continue;
    const rest = line.slice(m.index + m[0].length);
    const candidates = rest.trim() ? [rest.trim()] : [lines[i + 1] ?? ''];
    for (const candidate of candidates) {
      const value = NUMBER_VALUE.exec(candidate)?.[1];
      if (value && /\d/.test(value) && !parseDateAny(value)) return value;
    }
  }
  return null;
}

function findInvoiceNumber(lines: string[]): string | null {
  const strong = numberAfter(STRONG_NUMBER, lines);
  if (strong) return strong;
  // A title line "Rechnung 2026-0042" carries the number without a label.
  for (const line of lines.slice(0, 25)) {
    const m = /^(?:rechnung|invoice|gutschrift)\s+([A-Z]*[-/]?\d[A-Z0-9\-/._]*)$/i.exec(line);
    if (m?.[1] && !parseDateAny(m[1])) return m[1];
  }
  return numberAfter(WEAK_NUMBER, lines);
}

const NOT_ISSUE_DATE =
  /fällig|faellig|zahlbar|due|liefer|leistung|zeitraum|period|gültig|gueltig|valid|bis\b/i;

function findInvoiceDate(lines: string[]): string | null {
  const labels = [
    /rechnungsdatum|belegdatum|invoice date|ausstellungsdatum|date of issue/i,
    /(?<![a-zäöü])(datum|date)(?![a-z])/i,
  ];
  for (const label of labels) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const m = label.exec(line);
      if (!m || (label !== labels[0] && NOT_ISSUE_DATE.test(line))) continue;
      const found =
        dateIn(line.slice(m.index)) ??
        (line.slice(m.index + m[0].length).trim() ? null : dateIn(lines[i + 1] ?? ''));
      if (found) return found;
    }
  }
  for (const line of lines) {
    if (NOT_ISSUE_DATE.test(line)) continue;
    const found = dateIn(line);
    if (found) return found;
  }
  return null;
}

function findDueDate(lines: string[], invoiceDate: string | null): string | null {
  const label =
    /(fällig(?:keit)?(?:sdatum)?(?:\s+am)?|faellig(?:\s+am)?|zahlbar\s+bis(?:\s+zum)?|zahlungsziel|due date|payable by|due by|bis\s+(?:spätestens\s+)?zum)\s*[:.]?\s*/i;
  for (const line of lines) {
    const m = label.exec(line);
    if (!m) continue;
    const found = dateIn(line.slice(m.index + m[0].length));
    if (found) return found;
  }
  // A direct debit names its collection day: "wird am 15.09.2026 ... abgebucht".
  for (const line of lines) {
    if (!/abgebucht|eingezogen|belastet|abbuchung|einzug/i.test(line)) continue;
    const found = dateIn(line);
    if (found) return found;
  }
  if (!invoiceDate) return null;
  // Payment terms in days: the longest term is the net one (Skonto terms are shorter).
  let days: number | null = null;
  for (const line of lines) {
    if (!/zahlbar|zahlungsziel|zahlungsbedingung|payment|netto|ohne abzug|due/i.test(line))
      continue;
    for (const m of line.matchAll(/(\d{1,3})\s*(?:tage|tagen|days)/gi)) {
      days = Math.max(days ?? 0, Number(m[1]));
    }
  }
  return days === null ? null : addDays(invoiceDate, days);
}

function labelledAmounts(lines: string[], label: RegExp): number[] {
  const found: number[] = [];
  lines.forEach((line, i) => {
    if (!label.test(line)) return;
    if (NET.test(line) && !GROSS_HINT.test(line)) return;
    if (VAT.test(line) && !GROSS_HINT.test(line) && !STRONG_GROSS.test(line)) return;
    let amounts = amountsOn(line);
    const next = lines[i + 1] ?? '';
    // Table layouts print the amount below its label.
    if (!amounts.length && next.replace(/[^a-zäöü]/gi, '').length <= 4) amounts = amountsOn(next);
    found.push(...amounts.map(Math.abs));
  });
  return found;
}

function findGross(lines: string[]): number | null {
  const strong = labelledAmounts(lines, STRONG_GROSS);
  if (strong.length) return Math.max(...strong);
  const weak = labelledAmounts(lines, WEAK_GROSS);
  return weak.length ? Math.max(...weak) : null;
}

/**
 * VAT lines ("MwSt 19 % 19,00", "enth. MwSt 19% 1,60", "19% 8,40 1,60 10,00") are summed once per
 * rate. With several amounts on a line the one that fits rate × base wins, then the middle of a
 * net + VAT = gross triple, then the last amount.
 */
function findVat(lines: string[]): number | null {
  const perRate = new Map<string, number>();
  let unrated: number | null = null;
  for (const line of lines) {
    if (!(VAT.test(line) || TAX_CLASS.test(line)) || TAX_ID.test(line)) continue;
    // A total including/excluding VAT is gross/net, even if its label contains VAT.
    // Flattened table columns cannot supply a safe VAT fallback from that total.
    if (
      (STRONG_GROSS.test(line) ||
        (WEAK_GROSS.test(line) && (GROSS_HINT.test(line) || NET.test(line)))) &&
      !/enth|davon/i.test(line)
    )
      continue;
    const rateMatch = /(\d{1,2}(?:[.,]\d{1,2})?)\s?%/.exec(line);
    const rate = rateMatch ? Number((rateMatch[1] ?? '').replace(',', '.')) : null;
    const amounts = amountsOn(line).map(Math.abs);
    if (!amounts.length) continue;
    const vat = pickVat(amounts, rate);
    if (rate === null) {
      unrated ??= vat;
      continue;
    }
    const key = String(rate);
    if (!perRate.has(key)) perRate.set(key, vat);
  }
  if (perRate.size) return [...perRate.values()].reduce((a, b) => a + b, 0);
  return unrated;
}

function pickVat(amounts: number[], rate: number | null): number {
  if (rate !== null && amounts.length >= 2) {
    for (const vat of amounts) {
      if (
        amounts.some((base) => base !== vat && Math.abs(Math.round((base * rate) / 100) - vat) <= 2)
      )
        return vat;
    }
  }
  if (amounts.length >= 3) {
    for (const a of amounts) {
      for (const b of amounts) {
        if (a !== b && amounts.some((c) => c !== a && c !== b && Math.abs(a + b - c) <= 1))
          return Math.min(a, b);
      }
    }
  }
  return amounts[amounts.length - 1] ?? 0;
}

const CURRENCY_TOKEN = String.raw`(?:EUR|USD|CHF|GBP|euros?)(?![a-z])|US\$|[€£$]`;
const CURRENCY_AMOUNT = String.raw`[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?`;
const TOTAL_CURRENCY_LABEL = new RegExp(
  `^(?:${STRONG_GROSS.source}|amount paid|total paid|paid|payment amount|total charge|invoice total|total amount|(?:prix|montant(?: total)?)\\s+TTC|total|gesamt|summe|betrag)\\b`,
  'i',
);
const CONVERSION =
  /exchange rate|wechselkurs|conversion|converted|umrechnung|umgerechnet|equivalent/i;

function currencyCode(token: string): string {
  if (/^(?:EUR|euros?|€)$/i.test(token)) return 'EUR';
  if (/^(?:USD|US\$|\$)$/i.test(token)) return 'USD';
  if (/^(?:GBP|£)$/i.test(token)) return 'GBP';
  return 'CHF';
}

function currenciesByAmount(text: string): string[] {
  const found: string[] = [];
  for (const [pattern, currencyIndex, amountIndex] of [
    [String.raw`(?<![\w.,/-])(${CURRENCY_TOKEN})\s*(${CURRENCY_AMOUNT})(?![\w.,/%-])`, 1, 2],
    [String.raw`(?<![\w.,/-])(${CURRENCY_AMOUNT})\s*(${CURRENCY_TOKEN})(?![a-z])`, 2, 1],
  ] as const) {
    for (const match of text.matchAll(new RegExp(pattern, 'gi'))) {
      if (parseAmountCents(match[amountIndex]!, 'auto') !== null)
        found.push(currencyCode(match[currencyIndex]!));
    }
  }
  return found;
}

function findCurrency(lines: string[]): string | null {
  const bound = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const declaration =
      /^(?:invoice currency|currency|rechnungswährung|währung)\s*:?\s*(EUR|USD|CHF|GBP)\s*$/i.exec(
        line,
      );
    if (declaration) bound.add(declaration[1]!.toUpperCase());
    const label = TOTAL_CURRENCY_LABEL.exec(line);
    if (!label || (NET.test(line) && !GROSS_HINT.test(line))) continue;
    let value = line.slice(label[0].length).replace(/^\s*:?\s*/, '');
    value = value.replace(/^(?:incl(?:uding)?\.?\s*(?:VAT|tax)|brutto|TTC)\s*:?\s*/i, '');
    // A table may put just the monetary value directly below the label.
    if (!value) value = lines[i + 1] ?? '';
    // Keep secondary tax/conversion amounts out of the labelled total's value segment.
    value = value.split(
      /\b(?:VAT|tax|MwSt|TVA|exchange rate|wechselkurs|conversion|converted|umrechnung|umgerechnet|equivalent)\b/i,
    )[0]!;
    for (const code of currenciesByAmount(value)) bound.add(code);
  }
  if (bound.size) return bound.size === 1 ? [...bound][0]! : null;
  // Preserve unambiguous single-currency documents, without choosing by global EUR priority.
  // A conversion-only amount cannot establish the missing invoice currency.
  const fallback = new Set<string>();
  for (const line of lines) {
    if (CONVERSION.test(line)) continue;
    for (const token of line.matchAll(
      /€|\bEUR\b|\beuros?\b|\bUSD\b|US\$|\$(?=\s*[-+]?\d)|\bCHF\b|\bGBP\b|£/gi,
    ))
      fallback.add(currencyCode(token[0]));
  }
  return fallback.size === 1 ? [...fallback][0]! : null;
}

const LEGAL_FORM =
  /\b(GmbH|mbH|KGaA|GbR|OHG|Ltd|Inc|LLC|SARL|S\.à r\.l|e\.\s?K|e\.\s?V|B\.V)(?![a-z])/i;
const LEGAL_FORM_UPPER = /\b(AG|KG|SE|UG)\b/;
const RECIPIENT =
  /rechnungsempf|rechnungsadresse|lieferanschrift|lieferadresse|bill to|ship to|kunde:|customer:|an:/i;
const DOCUMENT_WORDS =
  /rechnung|quittung|kassenbon|kassenbeleg|invoice|receipt|beleg|gutschrift|lieferschein|angebot|seite|page|datum|kunde/i;

function hasLegalForm(line: string): boolean {
  return LEGAL_FORM.test(line) || LEGAL_FORM_UPPER.test(line);
}

/** One-line sender addresses ("Muster GmbH · Str. 1 · 12345 Ort"): keep the part with the name. */
function nameSegment(line: string): string {
  const segments = line.split(/\s[·•|]\s|\s{2,}|\s[-\u2013]\s|,\s/);
  const named = segments.find(hasLegalForm) ?? segments[0] ?? line;
  return named.trim().slice(0, 80);
}

function findIssuer(lines: string[]): string | null {
  let skipUntil = -1;
  const recipientLines = lines.map((line, i) => {
    if (RECIPIENT.test(line)) skipUntil = i + 3;
    return i <= skipUntil;
  });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (recipientLines[i]) continue;
    if (
      hasLegalForm(line) &&
      !TAX_ID.test(line) &&
      !/amtsgericht|registergericht|hrb/i.test(line)
    ) {
      return nameSegment(line);
    }
  }
  for (let i = 1; i < Math.min(lines.length, 20); i++) {
    if (recipientLines[i]) continue;
    if (!/\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]/.test(lines[i] ?? '')) continue;
    const above = lines[i - 1] ?? '';
    const street =
      /(str\.|straße|strasse|weg|platz|allee|gasse|ring|damm|ufer)\b|\d+\s?[a-z]?$/i.test(above);
    const candidateIndex = street ? i - 2 : i - 1;
    if (recipientLines[candidateIndex]) continue;
    const candidate = lines[candidateIndex];
    if (candidate && /[a-zäöü]{3}/i.test(candidate) && !DOCUMENT_WORDS.test(candidate))
      return nameSegment(candidate);
  }
  const first = lines[0];
  if (
    first &&
    !recipientLines[0] &&
    !/\d/.test(first) &&
    /[a-zäöü]{3}/i.test(first) &&
    first.split(' ').length <= 6 &&
    !DOCUMENT_WORDS.test(first)
  ) {
    return first.slice(0, 80);
  }
  return null;
}
