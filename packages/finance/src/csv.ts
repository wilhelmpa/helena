import {
  findIbans,
  normalizeIban,
  parseAmountCents,
  parseDateAny,
  type AmountStyle,
  type DateOrder,
} from './money';
import { isPaymentIntermediary, transliterate } from './names';
import { FinanceParseError, type BankEntry, type BankStatement } from './types';

/**
 * German bank CSV exports differ in encoding, delimiter, preamble, header names, decimal style,
 * sign convention and footer. Instead of one parser per bank, the header row is found by synonym
 * hits and columns are mapped by normalized header names, so unknown banks with similar exports
 * work too. Tested layouts: Sparkasse CSV-CAMT, DKB (2023), ING, N26, VR/Atruvia, Deutsche Bank,
 * Commerzbank.
 */

type Field =
  | 'ownAccount'
  | 'bookingDate'
  | 'valueDate'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'indicator'
  | 'payer'
  | 'payee'
  | 'cpName'
  | 'cpIban'
  | 'cpBic'
  | 'purpose'
  | 'bookingText'
  | 'endToEnd'
  | 'mandate'
  | 'creditorId'
  | 'balance'
  | 'status';

/** Header synonyms per field, in the priority order they are tried (normalized on load). */
const SYNONYMS: Record<Field, string[]> = {
  ownAccount: ['auftragskonto', 'iban auftragskonto', 'iban kontoinhaber'],
  bookingDate: ['buchungstag', 'buchungsdatum', 'buchung', 'datum', 'booking date', 'date'],
  valueDate: ['valutadatum', 'valuta', 'wertstellung', 'wertstellungsdatum', 'wert', 'value date'],
  amount: ['betrag', 'betrag eur', 'umsatz', 'amount eur', 'amount', 'zahlungsbetrag', 'brutto'],
  debit: ['soll'],
  credit: ['haben'],
  indicator: ['s/h', 'soll/haben', 'kennzeichen'],
  payer: ['zahlungspflichtige', 'zahlungspflichtiger'],
  payee: ['zahlungsempfaenger', 'zahlungsempfaengerin'],
  cpName: [
    'beguenstigter/zahlungspflichtiger',
    'auftraggeber/empfaenger',
    'beguenstigter / auftraggeber',
    'auftraggeber / beguenstigter',
    'name zahlungsbeteiligter',
    'partner name',
    'payee',
    'counterparty name',
    'name',
    'empfaenger',
  ],
  cpIban: [
    'kontonummer/iban',
    'iban / kontonummer',
    'iban zahlungsbeteiligter',
    'partner iban',
    'counterparty iban',
    'account number',
    'iban',
    'kontonummer',
  ],
  cpBic: ['bic (swift-code)', 'bic', 'bic (swift-code) zahlungsbeteiligter', 'blz'],
  purpose: [
    'verwendungszweck',
    'payment reference',
    'reference',
    'buchungsdetails',
    'beschreibung',
    'mitteilung',
  ],
  bookingText: [
    'buchungstext',
    'umsatzart',
    'umsatztyp',
    'transaktionsart',
    'type',
    'transaction type',
  ],
  endToEnd: ['kundenreferenz (end-to-end)', 'kundenreferenz', 'end-to-end-referenz'],
  mandate: ['mandatsreferenz'],
  creditorId: ['glaeubiger id', 'glaeubiger-id'],
  balance: ['saldo', 'saldo nach buchung', 'kontostand'],
  status: ['status', 'info'],
};
const CURRENCY_SYNONYMS = ['waehrung', 'wkz', 'currency'];
const FIELDS = Object.keys(SYNONYMS) as Field[];

/** Columns that only look like a field: original currency amounts, the own account, counters. */
const NOT_A_FIELD =
  /original|ursprung|fremde|abweichend|anzahl|sammler|auslagen|wechselkurs|exchange|kategorie/;
const OWN_ACCOUNT_COLUMN = /auftragskonto|kontoinhaber/;

export function normalizeHeader(cell: string): string {
  return transliterate(cell.toLowerCase())
    .replace(/["']/g, '')
    .replace(/\((€|eur)\)/g, '')
    .replace(/\*(r|in)\b/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED = Object.fromEntries(
  FIELDS.map((field) => [field, SYNONYMS[field].map(normalizeHeader)]),
) as Record<Field, string[]>;
const NORMALIZED_CURRENCY = CURRENCY_SYNONYMS.map(normalizeHeader);

type Pass = 'exact' | 'prefix' | 'contains';

const PATTERNS = new Map<string, RegExp>();

function matches(header: string, synonym: string, pass: Pass): boolean {
  if (pass === 'exact') return header === synonym;
  const key = `${pass}:${synonym}`;
  let pattern = PATTERNS.get(key);
  if (!pattern) {
    const escaped = synonym.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    pattern = new RegExp(
      pass === 'prefix' ? `^${escaped}(?![a-z0-9])` : `(?<![a-z0-9])${escaped}(?![a-z0-9])`,
    );
    PATTERNS.set(key, pattern);
  }
  return pattern.test(header);
}

interface ColumnMap {
  fields: Partial<Record<Field, number>>;
  currency: number[];
  hits: number;
}

/** Maps header cells to fields: exact names first, then prefixes, then contained words. */
function mapColumns(cells: string[]): ColumnMap {
  const headers = cells.map(normalizeHeader);
  const fields: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();
  const currency: number[] = [];
  headers.forEach((h, i) => {
    if (NORMALIZED_CURRENCY.includes(h)) {
      currency.push(i);
      taken.add(i);
    }
  });
  for (const pass of ['exact', 'prefix', 'contains'] as const) {
    for (const field of FIELDS) {
      if (fields[field] !== undefined) continue;
      for (const synonym of NORMALIZED[field]) {
        const index = headers.findIndex((h, i) => {
          if (taken.has(i) || !h) return false;
          if (pass !== 'exact') {
            if (NOT_A_FIELD.test(h)) return false;
            if (field !== 'ownAccount' && OWN_ACCOUNT_COLUMN.test(h)) return false;
          }
          return matches(h, synonym, pass);
        });
        if (index >= 0) {
          fields[field] = index;
          taken.add(index);
          break;
        }
      }
    }
  }
  headers.forEach((h, i) => {
    if (
      !taken.has(i) &&
      !NOT_A_FIELD.test(h) &&
      NORMALIZED_CURRENCY.some((s) => matches(h, s, 'contains'))
    ) {
      currency.push(i);
    }
  });
  // Commerzbank has no purpose column: its "Buchungstext" is the purpose and "Umsatzart" the type.
  if (fields.purpose === undefined && fields.bookingText !== undefined) {
    const textColumn = headers.indexOf('buchungstext');
    if (textColumn >= 0) {
      fields.purpose = textColumn;
      const other = headers.findIndex(
        (h, i) => i !== textColumn && NORMALIZED.bookingText.includes(h),
      );
      if (other >= 0) fields.bookingText = other;
      else delete fields.bookingText;
    }
  }
  return {
    fields,
    currency: currency.sort((a, b) => a - b),
    hits: Object.keys(fields).length + (currency.length ? 1 : 0),
  };
}

function isHeader(map: ColumnMap): boolean {
  const f = map.fields;
  const hasDate = f.bookingDate !== undefined || f.valueDate !== undefined;
  const hasAmount = f.amount !== undefined || (f.debit !== undefined && f.credit !== undefined);
  return map.hits >= 3 && hasDate && hasAmount;
}

/** Decodes bank export bytes: UTF-8 (with or without BOM), UTF-16 LE with BOM, else Windows-1252. */
export function decodeText(input: Uint8Array | string): string {
  if (typeof input === 'string') return input.replace(/^\uFEFF/, '');
  if (input[0] === 0xff && input[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(input.subarray(2));
  const body =
    input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1252').decode(body);
  }
}

/** Splits CSV text into rows, honouring quoted fields with doubled quotes and line breaks. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const isEmptyRow = (row: string[]) => row.every((c) => c.trim() === '');

/** Picks the delimiter whose most common field count (above one) covers the most cells. */
function sniff(text: string): { rows: string[][]; delimiter: string } {
  let best: { rows: string[][]; delimiter: string; score: number } | null = null;
  for (const delimiter of [';', ',', '\t', '|']) {
    const rows = splitCsv(text, delimiter);
    const counts = new Map<number, number>();
    for (const row of rows) {
      if (row.length > 1 && !isEmptyRow(row))
        counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    }
    let score = 0;
    for (const [fieldsPerRow, frequency] of counts)
      score = Math.max(score, fieldsPerRow * frequency);
    if (!best || score > best.score) best = { rows, delimiter, score };
  }
  return best ?? { rows: [], delimiter: ';' };
}

function detectAmountStyle(values: string[], fallback: AmountStyle): AmountStyle {
  let de = 0;
  let en = 0;
  for (const raw of values) {
    const v = raw.replace(/[\s\u00a0]|eur|€/gi, '');
    if (/\d,\d{1,2}-?$/.test(v) || /\.\d{3},/.test(v)) de++;
    else if (/\d\.\d{1,2}-?$/.test(v) || /,\d{3}\./.test(v)) en++;
  }
  if (de > en) return 'de';
  if (en > de) return 'en';
  return fallback;
}

function detectDateOrder(values: string[]): DateOrder | undefined {
  let dmy = 0;
  let mdy = 0;
  for (const value of values) {
    const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}/.exec(value);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return undefined;
}

const PENDING = /vorgemerkt|pending|nicht gebucht|reserviert|in bearbeitung/i;

export interface SepaTags {
  purpose: string;
  endToEndId: string | null;
  mandateId: string | null;
  creditorId: string | null;
  iban: string | null;
  ultimateName: string | null;
}

const TAG_PATTERN =
  /(?<![A-Za-z])(EREF|KREF|MREF|CRED|SVWZ|ABWA|ABWE|IBAN|BIC|DEBT|COAM|OAMT)(\+|:\s?)|(End-to-End-Ref\.:|Mandatsref:|Gläubiger-ID:|Glaeubiger-ID:|Kundenreferenz:)/g;
const LABEL_TAGS: Record<string, string> = {
  'End-to-End-Ref.:': 'EREF',
  'Mandatsref:': 'MREF',
  'Gläubiger-ID:': 'CRED',
  'Glaeubiger-ID:': 'CRED',
  'Kundenreferenz:': 'KREF',
};
/** Free-text tags whose value is a sentence rather than a single identifier. */
const TEXT_TAGS = new Set(['SVWZ', 'ABWA', 'ABWE']);

/**
 * Pulls SEPA fields out of a purpose line. MT940-style tags ("EREF+", "SVWZ+") run until the next
 * tag; colon-style labels (VR "EREF: ", Commerzbank "Mandatsref: ") take one token and leave the
 * rest of the text in the purpose.
 */
export function parseSepaTags(text: string): SepaTags {
  const tags: { name: string; plus: boolean; start: number; end: number }[] = [];
  for (const m of text.matchAll(TAG_PATTERN)) {
    const name = m[1] ?? LABEL_TAGS[m[3] ?? ''] ?? '';
    tags.push({ name, plus: m[2] === '+', start: m.index, end: m.index + m[0].length });
  }
  const values: Record<string, string> = {};
  const rest: string[] = [text.slice(0, tags[0]?.start ?? text.length)];
  tags.forEach((tag, i) => {
    const raw = text.slice(tag.end, tags[i + 1]?.start ?? text.length).trim();
    if (tag.plus || TEXT_TAGS.has(tag.name)) {
      values[tag.name] ??= raw;
      return;
    }
    const [token = '', ...tail] = raw.split(/\s+/);
    values[tag.name] ??= token;
    rest.push(tail.join(' '));
  });
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const remainder = clean(rest.join(' '));
  const purpose = values.SVWZ ? clean(`${values.SVWZ} ${remainder}`) : remainder;
  const id = (value: string | undefined) => {
    const v = value?.replace(/\s+/g, '');
    return v && v.toUpperCase() !== 'NOTPROVIDED' ? v : null;
  };
  return {
    purpose,
    endToEndId: id(values.EREF),
    mandateId: id(values.MREF),
    creditorId: id(values.CRED)?.toUpperCase() ?? null,
    iban: values.IBAN ? normalizeIban(values.IBAN) : null,
    ultimateName: clean(values.ABWA ?? values.ABWE ?? '') || null,
  };
}

/**
 * Parses a German bank CSV export into one statement. Throws FinanceParseError when no header
 * row with at least a date and an amount column is found in the first 30 lines.
 */
export function parseBankCsv(input: Uint8Array | string): BankStatement {
  const { rows, delimiter } = sniff(decodeText(input));
  let headerIndex = -1;
  let map: ColumnMap | null = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const candidate = mapColumns(rows[i] ?? []);
    if (isHeader(candidate)) {
      headerIndex = i;
      map = candidate;
      break;
    }
  }
  if (!map) throw new FinanceParseError('no bank CSV header row found in the first 30 lines');
  const header = rows[headerIndex] ?? [];
  const f = map.fields;
  const warnings: string[] = [];
  const minCells = header.reduce((last, cell, i) => (cell.trim() ? i + 1 : last), 0);

  // The table ends at the first row with fewer cells or without a date (the footer).
  const data: { row: string[]; line: number }[] = [];
  let ended = -1;
  const dateColumn = f.bookingDate ?? f.valueDate ?? 0;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (isEmptyRow(row)) continue;
    const dateCell = row[dateColumn] ?? '';
    const pendingRow =
      PENDING.test(dateCell) || (f.status !== undefined && PENDING.test(row[f.status] ?? ''));
    if (row.length < minCells || (!parseDateAny(dateCell) && !pendingRow)) {
      ended = i;
      break;
    }
    data.push({ row, line: i + 1 });
  }
  if (ended >= 0) {
    const later = rows
      .slice(ended + 1)
      .filter((r) => !isEmptyRow(r) && r.length >= minCells && parseDateAny(r[dateColumn] ?? ''));
    if (later.length)
      warnings.push(`table ended at line ${ended + 1}; ${later.length} later rows were ignored`);
  }

  const column = (field: Field) => {
    const index = f[field];
    return index === undefined ? [] : data.map((d) => d.row[index] ?? '');
  };
  // Without a decisive value ("200", "1.234") a comma-separated file is English, others German.
  const fallbackStyle: AmountStyle = delimiter === ',' ? 'en' : 'de';
  const amountStyle = detectAmountStyle(
    [...column('amount'), ...column('debit'), ...column('credit')],
    fallbackStyle,
  );
  const balanceStyle = detectAmountStyle(column('balance'), amountStyle);
  const bookingOrder = detectDateOrder(column('bookingDate'));
  const valueOrder = detectDateOrder(column('valueDate')) ?? bookingOrder;
  const amountHeader = f.amount !== undefined ? (header[f.amount] ?? '') : '';
  const headerCurrency = /€|\beur\b/i.test(amountHeader) ? 'EUR' : null;
  const currencyColumn =
    map.currency.find((index) => f.amount !== undefined && index > f.amount) ?? map.currency[0];

  const entries: (BankEntry & { balanceCents: number | null })[] = [];
  for (const { row, line } of data) {
    const cell = (field: Field) => {
      const index = f[field];
      return index === undefined ? '' : (row[index] ?? '').trim();
    };
    const pending = PENDING.test(cell('status')) || PENDING.test(row[dateColumn] ?? '');
    const valueDate = parseDateAny(cell('valueDate'), valueOrder);
    const bookingDate = parseDateAny(cell('bookingDate'), bookingOrder) ?? valueDate;
    if (!bookingDate) {
      warnings.push(`line ${line} skipped: no date`);
      continue;
    }
    // Older Volksbank exports append the sign as a letter: "119,00 S".
    const signed = /^(.*\d)\s*([SH])$/i.exec(cell('amount'));
    const amountText = signed ? (signed[1] ?? '') : cell('amount');
    let cents = f.amount !== undefined ? parseAmountCents(amountText, amountStyle) : null;
    if (cents !== null && signed)
      cents = signed[2]?.toUpperCase() === 'S' ? -Math.abs(cents) : Math.abs(cents);
    if (cents === null && (f.debit !== undefined || f.credit !== undefined)) {
      const credit = parseAmountCents(cell('credit'), amountStyle);
      const debit = parseAmountCents(cell('debit'), amountStyle);
      if (credit) cents = Math.abs(credit);
      else if (debit !== null) cents = -Math.abs(debit);
      else if (credit === 0) cents = 0;
    }
    if (cents === null) {
      warnings.push(`line ${line} skipped: no amount`);
      continue;
    }
    const indicator = cell('indicator').toUpperCase();
    if (/^(S|D)/.test(indicator)) cents = -Math.abs(cents);
    else if (/^(H|C)/.test(indicator)) cents = Math.abs(cents);

    const tags = parseSepaTags(cell('purpose'));
    const payer = cell('payer');
    const payee = cell('payee');
    const name = cell('cpName');
    let counterpartyName = cents < 0 ? payee || name || payer : payer || name || payee;
    if (tags.ultimateName && (!counterpartyName || isPaymentIntermediary(counterpartyName))) {
      counterpartyName = tags.ultimateName;
    }
    const endToEnd = cell('endToEnd');
    const creditor = cell('creditorId').replace(/\s+/g, '').toUpperCase();
    const currencyCell = currencyColumn !== undefined ? (row[currencyColumn] ?? '').trim() : '';
    const balanceCell = cell('balance');
    entries.push({
      bookingDate,
      valueDate,
      amountCents: cents,
      currency: currencyCode(currencyCell) ?? headerCurrency ?? 'EUR',
      counterpartyName,
      counterpartyIban: normalizeIban(cell('cpIban')) ?? tags.iban,
      purpose: tags.purpose,
      endToEndId: endToEnd && endToEnd.toUpperCase() !== 'NOTPROVIDED' ? endToEnd : tags.endToEndId,
      mandateId: cell('mandate') || tags.mandateId,
      creditorId: creditor || tags.creditorId,
      bankReference: null,
      bankCode: null,
      bookingText: cell('bookingText') || null,
      status: pending ? 'pending' : 'booked',
      balanceCents: balanceCell ? parseAmountCents(balanceCell, balanceStyle) : null,
    });
  }

  const preamble = rows
    .slice(0, headerIndex)
    .map((r) => r.join(' '))
    .join('\n');
  const ownFromColumn =
    column('ownAccount')
      .map((v) => normalizeIban(v))
      .find(Boolean) ?? null;
  const accountIban = findIbans(preamble)[0] ?? ownFromColumn;
  const dates = entries.map((e) => e.bookingDate).sort();
  const { openingCents, closingCents } = balancesFromColumn(entries);
  return {
    format: 'csv',
    accountIban,
    currency: entries[0]?.currency ?? headerCurrency,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    openingCents,
    closingCents,
    entries: entries.map(({ balanceCents: _balance, ...entry }) => entry),
    warnings,
  };
}

/** "EUR", "eur" or "€" as an ISO code; anything else unknown. */
function currencyCode(cell: string): string | null {
  const symbols: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' };
  const code = symbols[cell] ?? cell.toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * With a running balance column the statement balances follow from the oldest and newest booked
 * rows. Exports list rows newest first or oldest first; when the first and last dates are equal
 * the direction is unknown and no balances are claimed.
 */
function balancesFromColumn(entries: (BankEntry & { balanceCents: number | null })[]) {
  const booked = entries.filter((e) => e.status === 'booked');
  const none = { openingCents: null, closingCents: null };
  const first = booked[0];
  const last = booked.at(-1);
  if (!first || !last || booked.some((e) => e.balanceCents === null)) return none;
  if (first.bookingDate === last.bookingDate) return none;
  const ascending = first.bookingDate < last.bookingDate;
  const newest = ascending ? last : first;
  const oldest = ascending ? first : last;
  if (newest.balanceCents === null || oldest.balanceCents === null) return none;
  return {
    openingCents: oldest.balanceCents - oldest.amountCents,
    closingCents: newest.balanceCents,
  };
}
