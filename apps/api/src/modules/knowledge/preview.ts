import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { mimeFromName } from '@repo/storage/mime';
import { absoluteVaultPath, assertNoSymlink, baseName, readVaultFile } from '@repo/vault';
import Papa from 'papaparse';
import { HttpError } from '#shared/lib';
import { serveFile } from '#modules/project-files/serve';

export const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 100;

const OFFICE = new Set([
  '.docx',
  '.doc',
  '.odt',
  '.pptx',
  '.ppt',
  '.odp',
  '.xlsx',
  '.xls',
  '.ods',
  '.rtf',
]);
const SHEETS = new Set(['.xlsx', '.xls', '.ods']);
const TABLE_TEXT = new Set(['.csv', '.tsv']);
const TEXT = new Set([
  '.md',
  '.txt',
  '.log',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.sh',
  '.sql',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.diff',
  '.patch',
  '.canvas',
  '.base',
]);
const LANGUAGES: Record<string, string> = {
  '.md': 'markdown',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.sh': 'shell',
  '.sql': 'sql',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.html': 'html',
  '.css': 'css',
  '.toml': 'toml',
  '.csv': 'csv',
  '.tsv': 'tsv',
};

export type PreviewKind = 'office' | 'table' | 'text' | 'media' | 'unsupported';
interface PreviewSheet {
  name: string;
  rows: string[][];
  truncated: boolean;
}

export function previewType(filename: string): {
  kind: PreviewKind;
  mime: string;
  language: string | null;
} {
  const extension = path.extname(filename).toLowerCase();
  const mime = extension === '.tsv' ? 'text/tab-separated-values' : mimeFromName(filename);
  const kind: PreviewKind = OFFICE.has(extension)
    ? 'office'
    : TABLE_TEXT.has(extension)
      ? 'table'
      : TEXT.has(extension) || /^text\//.test(mime) || /^application\/(json|yaml|xml)$/.test(mime)
        ? 'text'
        : mime === 'application/pdf' ||
            /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime) ||
            /^(audio|video)\//.test(mime)
          ? 'media'
          : 'unsupported';
  return { kind, mime, language: LANGUAGES[extension] ?? null };
}

export function previewUrl(relative: string, suffix = ''): string {
  return `/knowledge/preview${suffix}?path=${encodeURIComponent(relative)}`;
}

async function source(relative: string) {
  const file = await readVaultFile(relative, MAX_PREVIEW_BYTES);
  if (file.bytes.length > MAX_PREVIEW_BYTES) throw new HttpError(413, 'File is too large');
  return file;
}

async function fileInfo(relative: string) {
  await assertNoSymlink(relative);
  const info = await lstat(absoluteVaultPath(relative)).catch(() => {
    throw new HttpError(404, 'File not found');
  });
  if (!info.isFile()) throw new HttpError(400, 'Path is not a file');
  return info;
}

export async function previewMetadata(relative: string) {
  const type = previewType(relative);
  const info = await fileInfo(relative);
  const file = type.kind === 'media' || type.kind === 'unsupported' ? null : await source(relative);
  const content = type.kind === 'text' ? file!.bytes.toString('utf8') : '';
  return {
    path: relative,
    kind: type.kind,
    mime: type.mime,
    language: type.language,
    sizeBytes: info.size,
    sha256: file?.sha256 ?? null,
    ...(type.kind === 'office'
      ? {
          pdfUrl: previewUrl(relative, '/file'),
          ...(SHEETS.has(path.extname(relative).toLowerCase())
            ? { tableUrl: previewUrl(relative, '/table') }
            : {}),
        }
      : {}),
    ...(type.kind === 'media' ? { fileUrl: previewUrl(relative, '/file') } : {}),
    ...(type.kind === 'table' ? { tableUrl: previewUrl(relative, '/table') } : {}),
    ...(type.kind === 'text'
      ? { content: content.slice(0, MAX_TEXT_CHARS), truncated: content.length > MAX_TEXT_CHARS }
      : {}),
  };
}

export type Converter = (
  bytes: Uint8Array,
  extension: string,
  format: 'pdf' | 'table',
) => Promise<Response>;

export const convertViaWorker: Converter = async (bytes, extension, format) => {
  const socket = process.env.VOLITION_PREVIEW_SOCKET || '/run/volition-preview/convert.sock';
  let response: Response;
  try {
    response = await fetch(`http://localhost/convert?extension=${extension}&format=${format}`, {
      unix: socket,
      method: 'POST',
      body: bytes,
      headers: { 'content-type': 'application/octet-stream' },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new HttpError(504, 'Preview conversion timed out', 'preview_timeout');
    }
    throw new HttpError(503, 'Preview conversion service is unavailable', 'preview_unavailable');
  }
  if (response.ok) return response;
  const message = await response.text();
  throw new HttpError(
    response.status,
    message.slice(0, 300),
    response.status === 504
      ? 'preview_timeout'
      : response.status === 503
        ? 'preview_busy'
        : 'preview_conversion_failed',
  );
};

export async function previewFile(
  relative: string,
  request: Request,
  converter: Converter = convertViaWorker,
): Promise<Response> {
  const type = previewType(relative);
  if (type.kind === 'office') {
    const file = await source(relative);
    const converted = await converter(file.bytes, path.extname(relative).toLowerCase(), 'pdf');
    const headers = new Headers(converted.headers);
    headers.set('Content-Type', 'application/pdf');
    headers.set(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(baseName(relative).replace(/\.[^.]+$/, '.pdf'))}`,
    );
    headers.set('Cache-Control', 'private, no-cache');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(converted.body, { status: converted.status, headers });
  }
  if (type.kind !== 'media') throw new HttpError(400, 'This file has no binary preview');
  await fileInfo(relative);
  return serveFile({
    file: absoluteVaultPath(relative),
    filename: baseName(relative),
    contentType: type.mime,
    request,
    download: false,
    inline: () => true,
  });
}

export async function previewTable(relative: string, converter: Converter = convertViaWorker) {
  const extension = path.extname(relative).toLowerCase();
  if (!SHEETS.has(extension) && !TABLE_TEXT.has(extension))
    throw new HttpError(400, 'This file has no table preview');
  const file = await source(relative);
  if (TABLE_TEXT.has(extension)) {
    const text = file.bytes.toString('utf8').replace(/^\uFEFF/, '');
    const parsed = Papa.parse<string[]>(text, {
      delimiter: extension === '.tsv' ? '\t' : undefined,
      preview: MAX_ROWS + 1,
      skipEmptyLines: 'greedy',
    });
    if (parsed.errors.length) throw new HttpError(422, 'The table is damaged', 'preview_damaged');
    return {
      path: relative,
      sha256: file.sha256,
      sheets: [
        {
          name: baseName(relative),
          rows: parsed.data
            .slice(0, MAX_ROWS)
            .map((row) => row.slice(0, MAX_COLUMNS).map((cell) => cell.slice(0, 1000))),
          truncated:
            parsed.data.length > MAX_ROWS ||
            parsed.data.some(
              (row) => row.length > MAX_COLUMNS || row.some((cell) => cell.length > 1000),
            ),
        },
      ],
    };
  }
  const converted = await converter(file.bytes, extension, 'table');
  try {
    const { sheets } = (await converted.json()) as { sheets: PreviewSheet[] };
    if (!Array.isArray(sheets)) throw new Error('Invalid table');
    return {
      path: relative,
      sha256: file.sha256,
      sheets,
    };
  } catch {
    throw new HttpError(422, 'The spreadsheet is damaged', 'preview_damaged');
  }
}
