// Writes the brand files of every variant to apps/web/public/brand/<variant>/: the mark,
// the wordmark and the lockup as SVG, and the favicon and app icons as PNG and ICO.
// The PNGs are rasterised in-process with resvg (MPL-2.0); the pixel art sits on whole
// pixels at 16 and 32px, so those come out crisp without hinting.
//   bun run --cwd packages/brand build:assets
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { BRAND_VARIANTS, lockupSvg, markSvg, wordmarkSvg, type MarkSvgOptions } from '../src';

const OUT = join(import.meta.dirname, '../../../apps/web/public/brand');

const png = (svg: string, size: number) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

// An .ico holding PNG images (Windows Vista and every browser read those).
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

for (const variant of BRAND_VARIANTS) {
  const dir = join(OUT, variant);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, data: string | Uint8Array) => writeFileSync(join(dir, name), data);

  const small = markSvg(variant, SMALL);
  const large = markSvg(variant, LARGE);
  write('favicon.svg', small);
  write('mark.svg', large);
  write('favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: png(small, size) }))));
  write('icon-192.png', png(large, 192));
  write('icon-512.png', png(large, 512));
  // Platforms cut their own shape from these: the ink fills the square, and the art
  // stays inside the maskable safe zone (the inner 80%).
  write(
    'apple-touch-icon.png',
    png(markSvg(variant, { detail: 'large', frame: 'bleed', pad: 3 }), 180),
  );
  write(
    'icon-maskable-512.png',
    png(markSvg(variant, { detail: 'large', frame: 'bleed', pad: 4 }), 512),
  );
  for (const theme of ['dark', 'light'] as const) {
    write(`wordmark-${theme}.svg`, wordmarkSvg(variant, 'full', theme));
    write(`wordmark-compact-${theme}.svg`, wordmarkSvg(variant, 'compact', theme));
    write(`lockup-${theme}.svg`, lockupSvg(variant, theme));
  }
  console.log(`brand: ${variant} written`);
}
