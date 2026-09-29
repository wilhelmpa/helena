// A contact sheet of every brand file for review, rendered by Chromium from the files
// build:assets wrote (public/brand) and the mail header:
//   bun run --cwd packages/brand preview:sheet <out.png>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { markSvg, ORB } from '../src';
import { MAIL_INLINE_IMAGES, mailHeaderHtml } from '../src/mail';

const BRAND = join(import.meta.dirname, '../../../apps/web/public/brand');
const out = process.argv[2];
if (!out) throw new Error('usage: preview-sheet.ts <out.png>');

const uri = (mime: string, data: Uint8Array | Buffer) =>
  `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
const file = (name: string) =>
  uri(name.endsWith('.svg') ? 'image/svg+xml' : 'image/png', readFileSync(join(BRAND, name)));
const raster = (svg: string, size: number) =>
  uri('image/png', new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());

const img = (src: string, w: number, h = w, extra = '') =>
  `<img src="${src}" width="${w}" height="${h}" style="${extra}">`;
const cell = (label: string, body: string, bg = 'transparent') =>
  `<figure style="background:${bg}"><div class="art">${body}</div><figcaption>${label}</figcaption></figure>`;
const zoom = (src: string, px: number) => img(src, px * 8, px * 8, 'image-rendering:pixelated');

const small = {
  dark16: raster(markSvg('bare-dark'), 16),
  dark32: raster(markSvg('bare-dark'), 32),
  light16: raster(markSvg('bare-light'), 16),
  light32: raster(markSvg('bare-light'), 32),
};
const icon512 = file('icon-512.png');
const mail = mailHeaderHtml('Ava').replace(
  `cid:${MAIL_INLINE_IMAGES[0]!.cid}`,
  uri('image/png', Buffer.from(MAIL_INLINE_IMAGES[0]!.base64, 'base64')),
);
const wm = (name: string, h: number) => {
  const svg = readFileSync(join(BRAND, name), 'utf8');
  const [, , w, hh] = svg
    .match(/viewBox="([^"]+)"/)![1]!
    .split(' ')
    .map(Number);
  return img(file(name), Math.round((h * w!) / hh!), h);
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:32px;width:1536px;background:#E9E6DF;font:13px/1.4 system-ui,sans-serif;color:#55525C}
h1{font-size:22px;color:#1B1B1F;margin:0 0 20px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin:28px 0 10px}
.row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end}
figure{margin:0;padding:16px;border-radius:12px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.art{display:flex;gap:14px;align-items:flex-end}figcaption{font-size:12px}
.paper{background:${ORB.paper}}.ink{background:#131316;color:#8E8A96}
</style></head><body>
<h1>AVA · Marke (Orb + Wortmarke)</h1>
<h2>App-Icons (Partikel-Orb)</h2><div class="row">
${cell('icon-512 (256 angezeigt)', img(icon512, 256), ORB.paper)}
${cell('apple-touch-icon 180 (iOS rundet)', img(file('apple-touch-icon.png'), 180, 180, 'border-radius:40px'), ORB.paper)}
${cell('icon-192 → 64', img(file('icon-192.png'), 64), ORB.paper)}
${cell('maskable 512 (Kreis-Maske, 200)', img(file('icon-maskable-512.png'), 200, 200, 'border-radius:50%'), ORB.paper)}
${cell('maskable (Squircle)', img(file('icon-maskable-512.png'), 160, 160, 'border-radius:36px'), ORB.paper)}
</div>
<h2>Favicon und kleine Größen (Vektor), 32 · 16 · 16 px 8×</h2><div class="row">
${cell('hell (prefers-color-scheme: light)', img(small.light32, 32) + img(small.light16, 16) + zoom(small.light16, 16), '#FFFFFF')}
${cell('dunkel', img(small.dark32, 32) + img(small.dark16, 16) + zoom(small.dark16, 16), '#202124')}
${cell('favicon.ico 32 (8×)', zoom(small.dark32, 16), '#FFFFFF')}
${cell('mark.svg / mark-light.svg / mono', img(file('mark.svg'), 64) + img(file('mark-light.svg'), 64) + img(file('mark-mono.svg'), 64), '#DAD6CE')}
</div>
<h2>Wortmarke (Inter Light, 0,32 em) und kompakt (Sidebar, 10 px Versalhöhe)</h2><div class="row">
${cell('wordmark-light', wm('wordmark-light.svg', 56), ORB.paper)}
${cell('wordmark-dark', wm('wordmark-dark.svg', 56), '#131316')}
${cell('compact hell / dunkel', `<span style="padding:6px;background:${ORB.paper}">${wm('wordmark-compact-light.svg', 10)}</span><span style="padding:6px;background:#131316">${wm('wordmark-compact-dark.svg', 10)}</span>`, '#DAD6CE')}
</div>
<h2>Sidebar-Kopf (24 px Scheibe + kompakte Wortmarke)</h2><div class="row">
${cell('hell', `<span style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:${ORB.paper}">${img(small.light32, 24)}${wm('wordmark-compact-light.svg', 10)}</span>`, ORB.paper)}
${cell('dunkel', `<span style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:#18171c">${img(small.dark32, 24)}${wm('wordmark-compact-dark.svg', 10)}</span>`, '#18171c')}
</div>
<h2>Lockups</h2><div class="row">
${cell('lockup-light', wm('lockup-light.svg', 96), ORB.paper)}
${cell('lockup-dark', wm('lockup-dark.svg', 96), ORB.ink)}
${cell('lockup-light 32', wm('lockup-light.svg', 32), ORB.paper)}
${cell('lockup-dark 32', wm('lockup-dark.svg', 32), ORB.ink)}
</div>
<h2>Mail-Kopf und Social Preview</h2><div class="row">
${cell('Mail-Kopf (Orb als Inline-Bild, AVA als Text)', mail, '#FFFFFF')}
${cell('social-preview 1280×640 (640)', img(file('social-preview.png'), 640, 320), ORB.paper)}
</div>
</body></html>`;

const temp = mkdtempSync(join(tmpdir(), 'volition-sheet-'));
try {
  writeFileSync(join(temp, 'sheet.html'), html);
  execFileSync(
    'chromium',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1600,1900',
      '--virtual-time-budget=3000',
      `--screenshot=${out}`,
      `file://${join(temp, 'sheet.html')}`,
    ],
    { stdio: 'ignore' },
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(`sheet written to ${out}`);
