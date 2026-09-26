import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readXlsxFile, { type CellValue, type Sheet } from 'read-excel-file/node';
import JSZip from 'jszip';
import { parseMessage } from '@repo/mail';
import { hasProgram, runProgram } from './process';

// Text extraction for files that are not text themselves. It shells out to poppler
// (pdftotext, pdftoppm), tesseract and pandoc, and reads spreadsheets and slides itself.
// A machine without one of the programs gets the "unavailable" outcome, and the entry is
// extracted again once the program is installed.

export const EXTRACTION_LIMITS = {
  maxFileBytes: 100 * 1024 * 1024,
  maxImageBytes: 30 * 1024 * 1024,
  maxTextChars: 1_000_000,
  timeoutMs: 120_000,
  ocrPages: 30,
  ocrTimeoutMs: 600_000,
};

export type Extraction =
  | { status: 'done'; text: string }
  | { status: 'unavailable'; missing: string[] }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string };

type Extractor = 'pdf' | 'image' | 'pandoc' | 'xlsx' | 'pptx' | 'eml';

const EXTRACTOR_BY_EXTENSION: Record<string, Extractor> = {
  '.pdf': 'pdf',
  '.eml': 'eml',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.bmp': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.docx': 'pandoc',
  '.odt': 'pandoc',
  '.pptx': 'pptx',
  '.rtf': 'pandoc',
  '.epub': 'pandoc',
  '.xlsx': 'xlsx',
};

const PROGRAMS: Record<Extractor, string[]> = {
  eml: [],
  pdf: ['pdftotext'],
  image: ['tesseract'],
  pandoc: ['pandoc'],
  xlsx: [],
  pptx: [],
};

const OCR_LANGUAGES = 'deu+eng';

function extractorFor(relative: string): Extractor | null {
  return EXTRACTOR_BY_EXTENSION[path.extname(relative).toLowerCase()] ?? null;
}

export function isExtractable(relative: string): boolean {
  return extractorFor(relative) !== null;
}

// The programs an extraction of this file needs that are not installed.
export function missingPrograms(relative: string): string[] {
  const extractor = extractorFor(relative);
  return extractor ? PROGRAMS[extractor].filter((name) => !hasProgram(name)) : [];
}

function bounded(text: string): string {
  const clean = text
    .replace(/\f/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return clean.trim().slice(0, EXTRACTION_LIMITS.maxTextChars);
}

function failure(tool: string, result: { code: number; stderr: string; timedOut: boolean }) {
  const reason = result.timedOut ? 'timed out' : result.stderr.trim().split('\n')[0] || result.code;
  return { status: 'failed' as const, error: `${tool}: ${reason}` };
}

async function ocrImage(file: string, timeoutMs: number): Promise<Extraction> {
  const result = await runProgram(['tesseract', file, 'stdout', '-l', OCR_LANGUAGES], {
    timeoutMs,
    maxBytes: EXTRACTION_LIMITS.maxTextChars * 4,
  });
  if (result.code !== 0 && !result.truncated) return failure('tesseract', result);
  return { status: 'done', text: bounded(result.stdout) };
}

// A PDF without a text layer is a scan: its pages are rendered and read by OCR.
async function ocrPdf(file: string): Promise<Extraction> {
  const missing = ['pdftoppm', 'tesseract'].filter((name) => !hasProgram(name));
  if (missing.length > 0) return { status: 'unavailable', missing };
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-ocr-'));
  try {
    const started = Date.now();
    const render = await runProgram(
      [
        'pdftoppm',
        '-r',
        '200',
        '-gray',
        '-png',
        '-l',
        String(EXTRACTION_LIMITS.ocrPages),
        file,
        path.join(dir, 'page'),
      ],
      { timeoutMs: EXTRACTION_LIMITS.timeoutMs },
    );
    if (render.code !== 0) return failure('pdftoppm', render);
    const pages = (await readdir(dir)).filter((name) => name.endsWith('.png')).sort();
    const texts: string[] = [];
    for (const page of pages) {
      const left = EXTRACTION_LIMITS.ocrTimeoutMs - (Date.now() - started);
      if (left <= 0) return { status: 'failed', error: 'tesseract: timed out' };
      const result = await ocrImage(path.join(dir, page), left);
      if (result.status !== 'done') return result;
      texts.push(result.text);
    }
    return { status: 'done', text: bounded(texts.join('\n\n')) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractPdf(file: string): Promise<Extraction> {
  const result = await runProgram(['pdftotext', '-enc', 'UTF-8', '-layout', file, '-'], {
    timeoutMs: EXTRACTION_LIMITS.timeoutMs,
    maxBytes: EXTRACTION_LIMITS.maxTextChars * 4,
  });
  if (result.code !== 0 && !result.truncated) return failure('pdftotext', result);
  const text = bounded(result.stdout);
  if (text.replace(/\s/g, '').length >= 20) return { status: 'done', text };
  return ocrPdf(file);
}

async function extractWithPandoc(file: string): Promise<Extraction> {
  const result = await runProgram(['pandoc', '--to=plain', '--wrap=none', file], {
    timeoutMs: EXTRACTION_LIMITS.timeoutMs,
    maxBytes: EXTRACTION_LIMITS.maxTextChars * 4,
  });
  if (result.code !== 0 && !result.truncated) return failure('pandoc', result);
  return { status: 'done', text: bounded(result.stdout) };
}

function cellText(value: CellValue | null): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

// Every sheet as tab-separated rows under its name. read-excel-file pads the rows to the
// sheet's width and keeps blank rows; a row is written without its trailing empty cells,
// and a blank row not at all.
async function extractXlsx(file: string): Promise<Extraction> {
  let sheets: Sheet[];
  try {
    sheets = await readXlsxFile(await readFile(file), { trim: false });
  } catch (error) {
    return { status: 'failed', error: `xlsx: ${error instanceof Error ? error.message : error}` };
  }
  const lines: string[] = [];
  for (const { sheet, data } of sheets) {
    lines.push(`# ${sheet}`);
    for (const row of data) {
      const cells = row.map(cellText);
      while (cells.length > 0 && cells.at(-1) === '') cells.pop();
      if (cells.length > 0) lines.push(cells.join('\t'));
    }
    lines.push('');
  }
  return { status: 'done', text: bounded(lines.join('\n')) };
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return XML_ENTITIES[name] ?? entity;
  });
}

// The text runs of every slide, one paragraph per line. The pandoc Debian ships (3.1)
// reads no .pptx.
async function extractPptx(file: string): Promise<Extraction> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readFile(file));
  } catch (error) {
    return { status: 'failed', error: `pptx: ${error instanceof Error ? error.message : error}` };
  }
  const slideNumber = (name: string) => Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const texts: string[] = [];
  for (const name of slides) {
    const xml = await zip.file(name)!.async('string');
    const paragraphs = xml
      .split('</a:p>')
      .map((paragraph) =>
        [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((run) => run[1]).join(''),
      )
      .filter(Boolean)
      .map(decodeXml);
    texts.push(paragraphs.join('\n'));
  }
  return { status: 'done', text: bounded(texts.join('\n\n')) };
}

// Reads the text of one vault file. `file` is its absolute path.
export async function extractText(file: string): Promise<Extraction> {
  const extractor = extractorFor(file);
  if (!extractor) return { status: 'skipped', reason: 'unsupported type' };
  const missing = PROGRAMS[extractor].filter((name) => !hasProgram(name));
  if (missing.length > 0) return { status: 'unavailable', missing };
  const { size } = await stat(file);
  const limit =
    extractor === 'image' ? EXTRACTION_LIMITS.maxImageBytes : EXTRACTION_LIMITS.maxFileBytes;
  if (size > limit) return { status: 'skipped', reason: 'too large' };
  switch (extractor) {
    case 'eml': {
      const mail = await parseMessage(await readFile(file));
      return {
        status: 'done',
        text: bounded([mail.from?.name, mail.subject, mail.text].filter(Boolean).join('\n\n')),
      };
    }
    case 'pdf':
      return extractPdf(file);
    case 'image':
      return ocrImage(file, EXTRACTION_LIMITS.timeoutMs);
    case 'pandoc':
      return extractWithPandoc(file);
    case 'xlsx':
      return extractXlsx(file);
    case 'pptx':
      return extractPptx(file);
  }
}
