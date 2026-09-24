// Writes the brand files to apps/web/public/brand/: the mark, the wordmark, the lockups
// and the social preview as SVG, and the favicon and app icons as PNG and ICO. The PNGs
// are rasterised in-process with resvg (MPL-2.0); the pixel art sits on whole pixels at
// 16 and 32px, so those come out crisp without hinting, and the output is byte-identical
// on macOS and Linux.
//   bun run --cwd packages/brand build:assets
// social-preview.png carries live type (Inter, JetBrains Mono), which resvg cannot load
// from the woff2 packages; it is a browser screenshot of social-preview.svg at
// 1280 × 640 with both fonts installed, redone by hand when the SVG changes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { lockupSvg, markSvg, socialPreviewSvg, wordmarkSvg, type MarkSvgOptions } from '../src';

const OUT = join(import.meta.dirname, '../../../apps/web/public/brand');

const png = (svg: string, size: number) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

// An .ico holding PNG images (every browser and Windows since Vista read those).
function ico(images: { size: number; data: Uint8Array }[]): Uint8Array {
  const header = 6 + images.length * 16;
  const total = header + images.reduce((n, i) => n + i.data.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, i) => {
    const at = 6 + i * 16;
    view.setUint8(at, img.size >= 256 ? 0 : img.size);
    view.setUint8(at + 1, img.size >= 256 ? 0 : img.size);
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, img.data.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(img.data, offset);
    offset += img.data.length;
  });
  return out;
}

const SMALL: MarkSvgOptions = { detail: 'small', frame: 'tile' };
const LARGE: MarkSvgOptions = { detail: 'large', frame: 'tile' };

mkdirSync(OUT, { recursive: true });
const write = (name: string, data: string | Uint8Array) => writeFileSync(join(OUT, name), data);

const small = markSvg(SMALL);
const large = markSvg(LARGE);
write('favicon.svg', small);
write('mark.svg', large);
write('favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: png(small, size) }))));
write('icon-192.png', png(large, 192));
write('icon-512.png', png(large, 512));
// Platforms cut their own shape from these: the ink fills the square, and the art stays
// inside the maskable safe zone (the inner 80%).
write('apple-touch-icon.png', png(markSvg({ detail: 'large', frame: 'bleed', pad: 3 }), 180));
write('icon-maskable-512.png', png(markSvg({ detail: 'large', frame: 'bleed', pad: 4 }), 512));
for (const theme of ['dark', 'light'] as const) {
  write(`wordmark-${theme}.svg`, wordmarkSvg('full', theme));
  write(`wordmark-compact-${theme}.svg`, wordmarkSvg('compact', theme));
  write(`lockup-${theme}.svg`, lockupSvg(theme));
}
write('social-preview.svg', socialPreviewSvg());
console.log(`brand files written to ${OUT}`);
