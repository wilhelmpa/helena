import mammoth from 'mammoth';
import Papa from 'papaparse';
import {
  readSheet,
  SheetNotFoundError,
  type CellValue,
  type SheetData,
} from 'read-excel-file/node';
import { HttpError } from '#shared/lib';

// Turns an uploaded file into a flat table: the first non-empty row is the header,
// everything after it is data. Only what reading and importing one need — no
// formatting, formulas, or multiple sheets; the first sheet wins.

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
  totalRows: number;
  // The 1-based sheet row each entry of `rows` came from, blank rows included, so
  // a skipped row names the line the user sees in their spreadsheet. Optional so a
  // hand-built sheet can rely on the by-order fallback.
  rowNumbers?: number[];
}

// Bound on what one import may hold. A bigger file is refused at parse time rather
// than half-imported later.
export const MAX_IMPORT_ROWS = 1000;

// The extensions parseImportFile reads. An upload is not restricted to them — a
// chat attachment can be anything the instance accepts — but only these parse
// into a table.
export const TABLE_EXTENSIONS = ['.xlsx', '.csv', '.docx'] as const;

export function isTableFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function cellText(value: CellValue | null): string {
  return value == null ? '' : String(value);
}

// The first sheet, read with read-excel-file. Its rows start at A1 and keep blank rows,
// so a row's index is its sheet row. Formula cells hold the value the spreadsheet
// application computed last; rich text arrives as plain text.
async function parseXlsx(bytes: Buffer): Promise<ParsedSheet> {
  let data: SheetData;
  try {
    data = await readSheet(bytes);
  } catch (error) {
    if (error instanceof SheetNotFoundError) throw new HttpError(400, 'The workbook has no sheets');
    throw new HttpError(400, 'The file is not a readable .xlsx workbook');
  }
  return fromTable(
    data.map((row) => row.map(cellText)),
    'The sheet is empty',
  );
}

// Turns the bytes of a CSV file into text. A byte-order mark names the encoding; without
// one the file is UTF-8 when it decodes as UTF-8, and otherwise Windows-1252, which is
// what Excel on a German (or any Western) Windows writes for "CSV (Trennzeichen-getrennt)".
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// Reads CSV with PapaParse (RFC 4180 quoting and escaped quotes). The delimiter is
// guessed from the first rows: comma, semicolon (German Excel), tab or pipe. Line ends
// are made uniform first, so a file mixing CRLF and LF (an edited export) still splits
// into rows. Rows that hold only whitespace are dropped.
export function parseCsv(text: string): string[][] {
  const { data } = Papa.parse<string[]>(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), {
    delimitersToGuess: [',', ';', '\t', '|'],
    newline: '\n',
    skipEmptyLines: 'greedy',
  });
  return data.filter((row) => row.some((cell) => cell.trim() !== ''));
}

// Reads the first table out of mammoth's HTML through the built-in HTMLRewriter:
// a real parser, so no tag stripping or entity unescaping happens here — text
// chunks already arrive decoded.
// Decodes the handful of entities mammoth emits, in one pass over a lookup table:
// nothing is re-scanned after replacement, so an encoded ampersand can never
// turn into the start of another entity.
function decodeEntities(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,
    (entity: string, name: string): string => {
      const lower = name.toLowerCase();
      if (lower === 'amp') return '&';
      if (lower === 'lt') return '<';
      if (lower === 'gt') return '>';
      if (lower === 'quot') return '"';
      if (lower === 'apos') return "'";
      if (lower === 'nbsp') return ' ';
      const code = lower.startsWith('#x')
        ? parseInt(lower.slice(2), 16)
        : parseInt(lower.slice(1), 10);
      return Number.isNaN(code) ? entity : String.fromCodePoint(code);
    },
  );
}

async function parseDocx(bytes: Buffer): Promise<ParsedSheet> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: bytes }));
  } catch {
    throw new HttpError(400, 'The file is not a readable .docx document');
  }

  const rows: string[][] = [];
  let row: string[] | null = null;
  let cell: string | null = null;

  function endCell(): void {
    if (row !== null && cell !== null) row.push(decodeEntities(cell.replace(/\s+/g, ' ').trim()));
    cell = null;
  }
  function endRow(): void {
    endCell();
    if (row !== null && row.some((value) => value !== '')) rows.push(row);
    row = null;
  }

  try {
    // Draining the body is what runs the handlers.
    await new HTMLRewriter()
      .on('tr', {
        element() {
          endRow();
          row = [];
        },
      })
      .on('br', {
        element() {
          if (cell !== null) cell += ' ';
        },
      })
      .on('td, th', {
        element() {
          if (row === null) row = [];
          endCell();
          cell = '';
        },
        text(text) {
          if (cell !== null) cell += text.text;
        },
      })
      .transform(new Response(html))
      .arrayBuffer();
  } catch {
    throw new HttpError(400, 'The file is not a readable .docx document');
  }
  endRow();

  if (rows.length === 0) {
    throw new HttpError(
      400,
      'No table found in the document. Put the tasks in a table, or use .xlsx/.csv.',
    );
  }
  return fromTable(rows, 'The table in the document is empty');
}

// Takes raw grid rows, makes the first non-empty one the header, and keeps the
// rest that carry any value. Kept rows remember their grid position so skips can
// name the row the spreadsheet shows.
function fromTable(table: string[][], emptyMessage: string): ParsedSheet {
  const firstRow = table.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  if (firstRow === -1) throw new HttpError(400, emptyMessage);

  const width = Math.max(...table.map((row) => row.length));
  const headers = table[firstRow].map((cell) => cell.trim());
  while (headers.length < width) headers.push('');

  const kept: { row: string[]; sheetRow: number }[] = [];
  for (let i = firstRow + 1; i < table.length; i++) {
    if (!table[i].some((cell) => cell.trim() !== '')) continue;
    const filled = table[i].map((cell) => cell.trim());
    while (filled.length < width) filled.push('');
    kept.push({ row: filled, sheetRow: i + 1 });
  }
  if (kept.length > MAX_IMPORT_ROWS) {
    throw new HttpError(400, `The file holds more than ${MAX_IMPORT_ROWS} rows; split it first.`);
  }
  return {
    headers,
    rows: kept.map((entry) => entry.row),
    totalRows: kept.length,
    rowNumbers: kept.map((entry) => entry.sheetRow),
  };
}

export async function parseImportFile(bytes: Buffer, filename: string): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return parseXlsx(bytes);
  if (lower.endsWith('.csv')) return fromTable(parseCsv(decodeCsv(bytes)), 'The CSV file is empty');
  if (lower.endsWith('.docx')) return parseDocx(bytes);
  throw new HttpError(
    400,
    'Unsupported file type. Use .xlsx, .csv, or .docx (an old .xls file can be saved as .xlsx).',
  );
}
