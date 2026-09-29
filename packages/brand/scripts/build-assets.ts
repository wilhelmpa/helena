// Deterministic raster output from the single vector source. Run offline with:
// bun run --cwd packages/brand build:assets
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { faviconSvg, lockupSvg, markSvg, socialPreviewSvg, wordmarkSvg } from '../src';

const OUT = join(import.meta.dirname, '../../../apps/web/public/brand');
const FONTS = join(import.meta.dirname, '../../../apps/web/public/fonts');
const png = (svg: string, size: number) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

// resvg cannot read the bundled WOFF2 fonts. Chromium rasterises the preview with
// those exact local font files; the temporary HTML is self-contained and removed.
function previewPng(svg: string): Uint8Array {
  const temp = mkdtempSync(join(tmpdir(), 'volition-brand-'));
  const htmlPath = join(temp, 'preview.html');
  const pngPath = join(temp, 'preview.png');
  const font = (name: string) => readFileSync(join(FONTS, name)).toString('base64');
  const html = `<html><head><meta charset="utf-8"><style>
@font-face{font-family:InterVariable;src:url(data:font/woff2;base64,${font('helena-inter.woff2')}) format('woff2')}
@font-face{font-family:'JetBrains Mono Variable';src:url(data:font/woff2;base64,${font('helena-jetbrains-mono-latin.woff2')}) format('woff2')}
html,body{margin:0;width:1280px;height:640px;overflow:hidden}svg{display:block}
</style></head><body>${svg}</body></html>`;
  try {
    writeFileSync(htmlPath, html);
    execFileSync(
      'chromium',
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--window-size=1280,640',
        '--virtual-time-budget=2000',
        `--screenshot=${pngPath}`,
        `file://${htmlPath}`,
      ],
      { stdio: 'ignore' },
    );
    return readFileSync(pngPath);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

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
    view.setUint8(at, img.size);
    view.setUint8(at + 1, img.size);
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, img.data.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(img.data, offset);
    offset += img.data.length;
  });
  return out;
}

mkdirSync(OUT, { recursive: true });
const write = (name: string, data: string | Uint8Array) => writeFileSync(join(OUT, name), data);
const light = markSvg({ variant: 'tile-light' });
write('favicon.svg', faviconSvg());
write('mark.svg', light);
write('mark-dark.svg', markSvg({ variant: 'tile-dark' }));
write('mark-bare-light.svg', markSvg({ variant: 'bare-light' }));
write('mark-bare-dark.svg', markSvg({ variant: 'bare-dark' }));
write('mark-mono.svg', markSvg({ variant: 'mono' }));
const faviconImages = [16, 32, 48].map((size) => ({
  size,
  data: png(markSvg({ variant: 'tile-light', detail: size <= 24 ? 'small' : 'regular' }), size),
}));
write('favicon.ico', ico(faviconImages));
write('apple-touch-icon.png', png(light, 180));
write('icon-192.png', png(light, 192));
write('icon-512.png', png(light, 512));
// The art stays inside the maskable 80% safe zone; its background fills the canvas.
write('icon-maskable-512.png', png(markSvg({ variant: 'tile-light', inset: 10 }), 512));
for (const theme of ['dark', 'light'] as const) {
  write(`wordmark-${theme}.svg`, wordmarkSvg('full', theme));
  write(`wordmark-compact-${theme}.svg`, wordmarkSvg('compact', theme));
  write(`lockup-${theme}.svg`, lockupSvg(theme));
}
const preview = socialPreviewSvg();
write('social-preview.svg', preview);
write('social-preview.png', previewPng(preview));
console.log(`brand files written to ${OUT}`);
