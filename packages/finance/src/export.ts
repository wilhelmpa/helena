import { strToU8, zipSync, type Zippable } from 'fflate';

import { formatAmountDe } from './money';
import { transliterate } from './names';

export interface ExportReceipt {
  id: number;
  filename: string;
  vaultPath: string;
  issuer: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  grossCents: number | null;
  vatCents: number | null;
  currency?: string | null;
  /** The receipt is an e-invoice (XRechnung, ZUGFeRD); its XML is exported next to the PDF. */
  einvoice: boolean;
}

export interface ExportRow {
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string;
  counterpartyName: string;
  counterpartyIban: string | null;
  purpose: string;
  accountIban: string | null;
  /** Human name of the own account ("Geschäftskonto"); falls back to the IBAN, then the label. */
  accountLabel?: string | null;
  status: 'matched' | 'open' | 'no-receipt-needed';
  assignment: 'auto' | 'manual' | 'ai' | null;
  /** 0..1 */
  confidence: number | null;
  note: string | null;
  receipts: ExportReceipt[];
}

export interface MonthExportInput {
  /** 'YYYY-MM' */
  month: string;
  /** Name of the exported books (company or account), the fallback for "Eigenes Konto". */
  label: string;
  rows: ExportRow[];
  receiptsWithoutPayment: ExportReceipt[];
  fileOf(receipt: ExportReceipt): Uint8Array | null;
  xmlOf?(receipt: ExportReceipt): Uint8Array | null;
}

export interface MonthExport {
  zip: Uint8Array;
  /** The booking CSV (with BOM), also stored in the ZIP. */
  csv: string;
  /** Number of files in the ZIP: receipts, e-invoice XML and the CSVs. */
  files: number;
}

export const EXPORT_COLUMNS = [
  'Buchungsdatum',
  'Valuta',
  'Betrag',
  'Währung',
  'Gegenpartei',
  'Gegenpartei-IBAN',
  'Verwendungszweck',
  'Eigenes Konto',
  'Status',
  'Beleg-Datei',
  'Belegnummer',
  'Belegdatum',
  'Rechnungssteller',
  'Brutto',
  'USt-Betrag',
  'E-Rechnung',
  'Zuordnung',
  'Konfidenz',
  'Notiz',
];

const RECEIPT_COLUMNS = [
  'Beleg-Datei',
  'Belegnummer',
  'Belegdatum',
  'Rechnungssteller',
  'Brutto',
  'USt-Betrag',
  'Währung',
  'E-Rechnung',
];

const STATUS_LABEL: Record<ExportRow['status'], string> = {
  matched: 'zugeordnet',
  open: 'offen',
  'no-receipt-needed': 'kein Beleg nötig',
};
const ASSIGNMENT_LABEL: Record<NonNullable<ExportRow['assignment']>, string> = {
  auto: 'auto',
  manual: 'manuell',
  ai: 'KI',
};

/** Already compressed formats are stored, everything else deflated. */
const STORED = /\.(pdf|png|jpe?g|gif|webp|heic|heif|tiff?|zip)$/i;
const MAX_NAME = 100;

function sanitize(text: string): string {
  return transliterate(text)
    .replace(/[^A-Za-z0-9.,_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/**
 * Reserves a file stem that is free for every given extension in `taken` (compared case
 * insensitively, as Windows and macOS do) and returns it: ASCII only, at most 100 characters
 * including the extension, "_2", "_3" appended on collisions.
 */
function reserveStem(stem: string, extensions: string[], taken: Set<string>): string {
  const exts = extensions.map((e) => (e ? `.${sanitize(e).toLowerCase()}` : ''));
  const longest = Math.max(...exts.map((e) => e.length));
  const clean = sanitize(stem) || 'Beleg';
  const free = (base: string) => exts.every((e) => !taken.has(`${base}${e}`.toLowerCase()));
  let base = clean.slice(0, MAX_NAME - longest);
  for (let n = 2; !free(base); n++) {
    const suffix = `_${n}`;
    base = clean.slice(0, MAX_NAME - longest - suffix.length) + suffix;
  }
  for (const e of exts) taken.add(`${base}${e}`.toLowerCase());
  return base;
}

/** A safe, unique file name for the export ZIP (see reserveStem for the rules). */
export function exportFileName(stem: string, extension: string, taken: Set<string>): string {
  const base = reserveStem(stem, [extension], taken);
  return extension ? `${base}.${sanitize(extension).toLowerCase()}` : base;
}

function extensionOf(receipt: ExportReceipt): string {
  const from = (name: string) => /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase();
  return from(receipt.filename) ?? from(receipt.vaultPath) ?? 'pdf';
}

function dateDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/**
 * One CSV cell: quoted when it holds the delimiter, quotes, line breaks or edge spaces. Text cells
 * that start like a spreadsheet formula get a leading apostrophe, so opening the file in Excel
 * never executes a purpose line such as "=HYPERLINK(...)".
 */
function cell(value: string | number | null | undefined, text = false): string {
  let v = value === null || value === undefined ? '' : String(value);
  if (text && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function csvText(header: string[], lines: string[][]): string {
  const body = [header.map((h) => cell(h)), ...lines].map((l) => l.join(';')).join('\r\n');
  return `\uFEFF${body}\r\n`;
}

const amount = (cents: number | null) => (cents === null ? '' : formatAmountDe(cents));
const joined = (values: (string | null | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].join(' | ');
const sum = (values: (number | null)[]) =>
  values.length && values.every((v) => v !== null)
    ? values.reduce<number>((a, b) => a + (b ?? 0), 0)
    : null;

/**
 * Builds the monthly handover for the tax advisor: one ZIP with the booking CSV, the receipts
 * sorted into Ausgaben / Einnahmen / Belege-ohne-Zahlung (e-invoice XML next to its PDF), and a
 * CSV of receipts without a payment. The CSV is German Excel style: ";" separated, UTF-8 with
 * BOM, CRLF, decimal comma, dd.mm.yyyy.
 */
export function buildMonthExport(input: MonthExportInput): MonthExport {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    throw new RangeError(`month must be 'YYYY-MM', got '${input.month}'`);
  }
  const root = input.month;
  const entries: Zippable = {};
  const mtime = new Date(`${input.month}-01T12:00:00`);
  const taken = new Map<string, Set<string>>();
  const written = new Map<number, string>();

  const add = (path: string, data: Uint8Array) => {
    entries[`${root}/${path}`] = [data, { level: STORED.test(path) ? 0 : 6, mtime }];
  };

  /** Writes a receipt (and its XML) once and returns its path relative to the month folder. */
  const writeReceipt = (receipt: ExportReceipt, folder: string, stem: string): string | null => {
    const existing = written.get(receipt.id);
    if (existing !== undefined) return existing;
    const data = input.fileOf(receipt);
    if (!data) return null;
    const ext = extensionOf(receipt);
    const xml = ext !== 'xml' ? (input.xmlOf?.(receipt) ?? null) : null;
    const folderNames = taken.get(folder) ?? new Set<string>();
    taken.set(folder, folderNames);
    const base = reserveStem(stem, xml ? [ext, 'xml'] : [ext], folderNames);
    const path = `${folder}/${base}.${ext}`;
    add(path, data);
    if (xml) add(`${folder}/${base}.xml`, xml);
    written.set(receipt.id, path);
    return path;
  };

  const stemFor = (
    date: string | null,
    issuer: string,
    cents: number | null,
    currency: string,
    number: string | null,
  ) =>
    [
      date ?? 'ohne-Datum',
      issuer,
      cents === null ? null : `${formatAmountDe(Math.abs(cents))}${currency}`,
      number,
    ]
      .filter((p): p is string => !!p)
      .map((p) => sanitize(p))
      .join('_');

  const rows = [...input.rows].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
  const lines = rows.map((row) => {
    const folder = row.amountCents < 0 ? 'Ausgaben' : 'Einnahmen';
    const several = row.receipts.length > 1;
    const paths = row.receipts.map((receipt) => {
      const cents = several && receipt.grossCents !== null ? receipt.grossCents : row.amountCents;
      const issuer = receipt.issuer ?? (row.counterpartyName || 'Unbekannt');
      return writeReceipt(
        receipt,
        folder,
        stemFor(
          row.bookingDate,
          issuer,
          cents,
          receipt.currency ?? row.currency,
          receipt.invoiceNumber,
        ),
      );
    });
    const receipts = row.receipts;
    return [
      cell(dateDe(row.bookingDate)),
      cell(dateDe(row.valueDate)),
      cell(formatAmountDe(row.amountCents)),
      cell(row.currency),
      cell(row.counterpartyName, true),
      cell(row.counterpartyIban),
      cell(row.purpose, true),
      cell(row.accountLabel ?? row.accountIban ?? input.label, true),
      cell(STATUS_LABEL[row.status]),
      cell(joined(paths), true),
      cell(joined(receipts.map((r) => r.invoiceNumber)), true),
      cell(joined(receipts.map((r) => dateDe(r.invoiceDate))), true),
      cell(joined(receipts.map((r) => r.issuer)), true),
      cell(amount(sum(receipts.map((r) => r.grossCents)))),
      cell(amount(sum(receipts.map((r) => r.vatCents)))),
      cell(receipts.length ? (receipts.some((r) => r.einvoice) ? 'ja' : 'nein') : ''),
      cell(row.assignment ? ASSIGNMENT_LABEL[row.assignment] : ''),
      cell(row.confidence === null ? '' : row.confidence.toFixed(2).replace('.', ',')),
      cell(row.note, true),
    ];
  });
  const csv = csvText(EXPORT_COLUMNS, lines);
  add(`Buchungen_${input.month}.csv`, strToU8(csv));

  if (input.receiptsWithoutPayment.length) {
    const receiptLines = input.receiptsWithoutPayment.map((receipt) => {
      const currency = receipt.currency ?? 'EUR';
      const path = writeReceipt(
        receipt,
        'Belege-ohne-Zahlung',
        stemFor(
          receipt.invoiceDate,
          receipt.issuer ?? 'Unbekannt',
          receipt.grossCents,
          currency,
          receipt.invoiceNumber,
        ),
      );
      return [
        cell(path ?? '', true),
        cell(receipt.invoiceNumber, true),
        cell(dateDe(receipt.invoiceDate)),
        cell(receipt.issuer, true),
        cell(amount(receipt.grossCents)),
        cell(amount(receipt.vatCents)),
        cell(currency),
        cell(receipt.einvoice ? 'ja' : 'nein'),
      ];
    });
    add('Belege-ohne-Zahlung.csv', strToU8(csvText(RECEIPT_COLUMNS, receiptLines)));
  }

  return { zip: zipSync(entries), csv, files: Object.keys(entries).length };
}
