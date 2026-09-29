// Extracts the AVA wordmark as outlines from Inter (OFL-1.1), the web font the app
// already ships (apps/web/public/fonts/helena-inter.woff2). Run offline, only when the
// wordmark's weight or tracking changes:
//   bun run --cwd packages/brand extract:wordmark
// Chromium sets "AVA" exactly as the browser does (kerning, letter-spacing, the
// variable font's instance) and prints it to PDF; Skia writes a variable font's glyphs
// as Type3 outlines, which this script reads back and stores as SVG path data in
// src/wordmark-glyphs.ts. Nothing is downloaded.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const FONT = join(import.meta.dirname, '../../../apps/web/public/fonts/helena-inter.woff2');
const OUT = join(import.meta.dirname, '../src/wordmark-glyphs.ts');
const TEXT = 'AVA';
const SIZE = 200;
const UNITS = 2048;

interface Style {
  weight: number;
  opsz: number;
  tracking: number;
}
// full: the wordmark as the owner chose it (Inter Light, 0.32em). compact: the
// sidebar's size, where Light's hairlines fall below a device pixel; Regular with the
// text optical size keeps the same letters legible at 11px cap height.
const STYLES: Record<'full' | 'compact', Style> = {
  full: { weight: 300, opsz: 32, tracking: 0.32 },
  compact: { weight: 400, opsz: 14, tracking: 0.32 },
};

function printPdf(style: Style): Buffer {
  const temp = mkdtempSync(join(tmpdir(), 'volition-wordmark-'));
  const font = readFileSync(FONT).toString('base64');
  const html = `<html><head><meta charset="utf-8"><style>
@font-face{font-family:W;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
@page{size:1400px 400px;margin:0}body{margin:0}
p{margin:0;font-family:W;font-size:${SIZE}px;font-weight:${style.weight};letter-spacing:${style.tracking}em;font-variation-settings:'opsz' ${style.opsz}}
</style></head><body><p>${TEXT}</p></body></html>`;
  try {
    writeFileSync(join(temp, 'w.html'), html);
    execFileSync(
      'chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-pdf-header-footer',
        `--print-to-pdf=${join(temp, 'w.pdf')}`,
        `file://${join(temp, 'w.html')}`,
      ],
      { stdio: 'ignore' },
    );
    return readFileSync(join(temp, 'w.pdf'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// The objects of a PDF: dictionary text and (inflated) stream data by object number.
function objects(pdf: Buffer) {
  const s = pdf.toString('latin1');
  const out = new Map<string, { dict: string; stream?: string }>();
  for (const m of s.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
    const body = m[2] ?? '';
    const at = body.indexOf('stream');
    if (at < 0) {
      out.set(m[1]!, { dict: body });
      continue;
    }
    let start = (m.index ?? 0) + m[0].indexOf('stream') + 6;
    if (s[start] === '\r') start++;
    if (s[start] === '\n') start++;
    let data: Buffer = pdf.subarray(start, s.indexOf('endstream', start));
    const dict = body.slice(0, at);
    if (dict.includes('FlateDecode')) data = inflateSync(data);
    out.set(m[1]!, { dict, stream: data.toString('latin1') });
  }
  return out;
}

const round = (n: number) => String(Math.round(n * 10) / 10);

// A Type3 glyph procedure (m/l/c/h, filled) as SVG path data, moved right by dx.
function glyphPath(proc: string, dx: number): string {
  const parts: string[] = [];
  let args: number[] = [];
  for (const token of proc.split(/\s+/).filter(Boolean)) {
    const n = Number(token);
    if (!Number.isNaN(n)) {
      args.push(n);
      continue;
    }
    const pt = (i: number) => `${round(args[i]! + dx)} ${round(args[i + 1]!)}`;
    if (token === 'm') parts.push(`M${pt(0)}`);
    else if (token === 'l') parts.push(`L${pt(0)}`);
    else if (token === 'c') parts.push(`C${pt(0)} ${pt(2)} ${pt(4)}`);
    else if (token === 'h') parts.push('Z');
    args = [];
  }
  return parts.join('');
}

function extract(style: Style) {
  const objs = objects(printPdf(style));
  const page = [...objs.values()].find((o) => /\/Type \/Page\b/.test(o.dict))!;
  const fontRefs = Object.fromEntries(
    [...page.dict.matchAll(/\/(F\d+) (\d+) 0 R/g)].map((m) => [m[1]!, m[2]!]),
  );
  const contentId = page.dict.match(/\/Contents (\d+) 0 R/)![1]!;
  const content = objs.get(contentId)!.stream!;
  const d: string[] = [];
  let x = 0;
  let font = '';
  for (const m of content.matchAll(
    /\/(F\d+) [\d.]+ Tf|(-?[\d.]+) (-?[\d.]+) Td|<([0-9A-Fa-f]+)> Tj/g,
  )) {
    if (m[1]) font = m[1];
    else if (m[2]) x += (Number(m[2]) * UNITS) / SIZE;
    else if (m[4]) {
      const dict = objs.get(fontRefs[font]!)!.dict;
      const code = parseInt(m[4], 16);
      // Encoding /Differences [start /name /name ...]: code → glyph procedure name.
      const diff = dict.match(/\/Differences \[(\d+) ([^\]]*)\]/)!;
      const names = diff[2]!.trim().split(/\s+/);
      const name = names[code - Number(diff[1])]!.slice(1);
      const proc = dict.match(new RegExp(`/${name} (\\d+) 0 R`))![1]!;
      const stream = objs.get(proc)!.stream!;
      d.push(glyphPath(stream.slice(stream.indexOf('d1') + 2), x));
    }
  }
  const nums = d
    .join('')
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return {
    ...style,
    d: d.join(''),
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

const result = { full: extract(STYLES.full), compact: extract(STYLES.compact) };
writeFileSync(
  OUT,
  `// Generated by scripts/extract-wordmark.ts: "${TEXT}" in Inter (OFL-1.1, by Rasmus
// Andersson; apps/web/public/fonts/helena-inter.woff2 with its licence) as outlines, in
// font units (${UNITS} per em), y downwards, baseline at 0. Do not edit by hand.
export const WORDMARK_GLYPHS = ${JSON.stringify(result, null, 2)} as const;
`,
);
console.log(`wordmark outlines written to ${OUT}`);
