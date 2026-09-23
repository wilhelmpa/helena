import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

// Test files built at run time, so the repository holds no binaries: a PDF with a text
// layer, a scan (a PDF holding only an image of that page), a PNG and office files. The
// ones that need poppler or pandoc are only built where those are installed.

export const has = (program: string) => Bun.which(program) !== null;

export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function pdf(objects: (string | Buffer)[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.isBuffer(object) ? object : Buffer.from(object),
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(length),
    '%%EOF',
  ].join('\n');
  parts.push(Buffer.from(`${xref}\n`));
  return Buffer.concat(parts);
}

function stream(dictionary: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from('\nendstream'),
  ]);
}

// A one-page PDF with the lines as real text.
export function textPdf(lines: string[]): Buffer {
  const text = lines
    .map((line, index) => `${index === 0 ? '' : '0 -40 Td '}(${line}) Tj`)
    .join(' ');
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('', Buffer.from(`BT /F1 28 Tf 72 700 Td ${text} ET`)),
  ]);
}

async function run(argv: string[]): Promise<void> {
  const child = Bun.spawn(argv, { stdout: 'ignore', stderr: 'pipe' });
  if ((await child.exited) !== 0) {
    throw new Error(`${argv[0]} failed: ${await new Response(child.stderr).text()}`);
  }
}

// The page of a text PDF rendered as an image, the way a scanner produces it.
export async function scannedPage(dir: string, lines: string[], format: 'png' | 'pgm') {
  const source = path.join(dir, 'source.pdf');
  await writeFile(source, textPdf(lines));
  const out = path.join(dir, 'page');
  const formatFlag = format === 'png' ? ['-png'] : [];
  await run(['pdftoppm', '-r', '150', '-gray', '-singlefile', ...formatFlag, source, out]);
  return `${out}.${format}`;
}

// A PDF whose only content is an image of a page: no text layer, OCR needed.
export async function scannedPdf(dir: string, lines: string[]): Promise<Buffer> {
  const pgm = await readFile(await scannedPage(dir, lines, 'pgm'));
  const header = pgm.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (!header) throw new Error('unexpected PGM');
  const [whole, width, height] = header;
  const pixels = pgm.subarray(whole.length);
  const pageWidth = (Number(width) * 72) / 150;
  const pageHeight = (Number(height) * 72) / 150;
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`,
    stream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
      deflateSync(pixels),
    ),
    stream('', Buffer.from(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im1 Do Q`)),
  ]);
}

// An office file written by pandoc from Markdown.
export async function pandocFile(dir: string, markdown: string, extension: string) {
  const source = path.join(dir, 'source.md');
  await writeFile(source, markdown);
  const target = path.join(dir, `document.${extension}`);
  await run(['pandoc', source, '--standalone', '-o', target]);
  return target;
}
