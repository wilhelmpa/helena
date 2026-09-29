import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import readXlsxFile, { type CellValue } from 'read-excel-file/node';

const SOCKET = process.env.VOLITION_PREVIEW_SOCKET || '/run/volition-preview/convert.sock';
const CACHE = process.env.VOLITION_PREVIEW_CACHE || '/var/cache/volition-preview';
const MAX_INPUT = 50 * 1024 * 1024;
const MAX_OUTPUT = 100 * 1024 * 1024;
const EXTENSIONS = new Set([
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
const PDF_EXTENSIONS = EXTENSIONS;
const XLSX_EXTENSIONS = new Set(['.xls', '.ods']);
const TABLE_EXTENSIONS = new Set(['.xlsx', '.xls', '.ods']);
const MAX_ROWS = 2000;
const MAX_COLUMNS = 100;
const MAX_TABLE_OUTPUT = 10 * 1024 * 1024;

let queue = Promise.resolve();
let pending = 0;

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function convertOffice(
  bytes: Uint8Array,
  extension: string,
  format: 'pdf' | 'xlsx',
  cache = CACHE,
): Promise<{ file: string; cached: boolean }> {
  if (!(format === 'pdf' ? PDF_EXTENSIONS : XLSX_EXTENSIONS).has(extension))
    throw new Error('Unsupported office format');
  if (bytes.length > MAX_INPUT) throw new Error('Input is too large');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const target = path.join(cache, `${sha}${extension}.${format}`);
  await mkdir(cache, { recursive: true, mode: 0o700 });
  try {
    if ((await stat(target)).isFile()) return { file: target, cached: true };
  } catch {
    /* cache miss */
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'volition-preview-'));
  try {
    const input = path.join(temporary, `input${extension}`);
    const profile = path.join(temporary, 'profile');
    const output = path.join(temporary, `input.${format}`);
    await mkdir(path.join(profile, 'user'), { recursive: true });
    await writeFile(
      path.join(profile, 'user', 'registrymodifications.xcu'),
      '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>',
    );
    await writeFile(input, bytes);
    const command = [
      '/usr/bin/timeout',
      '--signal=TERM',
      '--kill-after=2s',
      '30s',
      '/usr/bin/soffice',
      `-env:UserInstallation=${pathToFileURL(profile)}`,
      '--headless',
      '--convert-to',
      format,
      '--outdir',
      temporary,
      input,
    ];
    const child = Bun.spawn(command, {
      cwd: temporary,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { PATH: '/usr/bin:/bin', HOME: temporary, TMPDIR: temporary, SAL_DISABLE_OPENCL: '1' },
    });
    const stderr = new Response(child.stderr).text();
    const code = await child.exited;
    const error = await stderr;
    if (code === 124 || code === 137) throw new Error('Conversion timed out');
    if (code !== 0) throw new Error(`Conversion failed: ${error.slice(0, 200)}`);
    const info = await stat(output).catch(() => null);
    if (!info?.isFile() || info.size === 0)
      throw new Error('The office document is damaged or unsupported');
    if (info.size > MAX_OUTPUT) throw new Error('Preview output is too large');
    const staged = `${target}.${process.pid}.tmp`;
    await copyFile(output, staged);
    await chmod(staged, 0o600);
    await rename(staged, target);
    return { file: target, cached: false };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function cellText(value: CellValue | null): string {
  if (value == null) return '';
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 1000);
}

export async function tableOffice(
  bytes: Uint8Array,
  extension: string,
  cache = CACHE,
): Promise<{ file: string; cached: boolean }> {
  if (!TABLE_EXTENSIONS.has(extension)) throw new Error('Unsupported spreadsheet format');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const target = path.join(cache, `${sha}${extension}.table.json`);
  await mkdir(cache, { recursive: true, mode: 0o700 });
  try {
    if ((await stat(target)).isFile()) return { file: target, cached: true };
  } catch {
    /* cache miss */
  }
  const workbook =
    extension === '.xlsx'
      ? bytes
      : await readFile((await convertOffice(bytes, extension, 'xlsx', cache)).file);
  let sheets;
  try {
    sheets = await readXlsxFile(Buffer.from(workbook), { trim: false });
  } catch {
    throw new Error('The spreadsheet is damaged');
  }
  const data = JSON.stringify({
    sheets: sheets.map(({ sheet, data }) => ({
      name: sheet,
      rows: data.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLUMNS).map(cellText)),
      truncated: data.length > MAX_ROWS || data.some((row) => row.length > MAX_COLUMNS),
    })),
  });
  if (Buffer.byteLength(data) > MAX_TABLE_OUTPUT) throw new Error('Preview output is too large');
  const staged = `${target}.${process.pid}.tmp`;
  await writeFile(staged, data, { mode: 0o600 });
  await rename(staged, target);
  return { file: target, cached: false };
}

export async function handlePreviewRequest(
  request: Request,
  converter: typeof convertOffice = convertOffice,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = new URL(request.url);
  const extension = url.searchParams.get('extension') ?? '';
  const format = url.searchParams.get('format');
  if (!(
    (format === 'pdf' && PDF_EXTENSIONS.has(extension)) ||
    (format === 'xlsx' && XLSX_EXTENSIONS.has(extension)) ||
    (format === 'table' && TABLE_EXTENSIONS.has(extension))
  )) {
    return new Response('Unsupported office format', { status: 400 });
  }
  if (Number(request.headers.get('content-length')) > MAX_INPUT)
    return new Response('Input is too large', { status: 413 });
  if (pending >= 3) return new Response('Preview conversion queue is full', { status: 503 });
  pending += 1;
  try {
    return await serial(async () => {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_INPUT) return new Response('Input is too large', { status: 413 });
      try {
        const result =
          format === 'table'
            ? await tableOffice(bytes, extension)
            : await converter(bytes, extension, format);
        return new Response(Bun.file(result.file), {
          headers: {
            'Content-Type':
              format === 'pdf'
                ? 'application/pdf'
                : format === 'table'
                  ? 'application/json'
                  : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'X-Preview-Cache': result.cached ? 'hit' : 'miss',
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Conversion failed';
        return new Response(message, {
          status: message.includes('timed out') ? 504 : message.includes('too large') ? 413 : 422,
        });
      }
    });
  } finally {
    pending -= 1;
  }
}

if (import.meta.main) {
  const server = Bun.serve({
    unix: SOCKET,
    maxRequestBodySize: MAX_INPUT,
    fetch: (request) => handlePreviewRequest(request),
  });
  await chmod(SOCKET, 0o660);
  console.log(`Preview worker listening on ${server.url}`);
}
