// Deterministic icon and logo files from the brand's sources. Run offline with:
//   bun run --cwd packages/brand build:assets
// Sources: the particle Orb renders in ../assets (the app's voice orb, speaking state,
// 90k particles, no glow, 1024px) for icons and large marks; the vector disc and the
// Inter wordmark outlines in ../src for everything at 48px and below.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import {
  faviconSvg,
  lockupSvg,
  markSvg,
  ORB,
  socialPreviewSvg,
  wordmarkSvg,
  type OrbImage,
} from '../src';

const ASSETS = join(import.meta.dirname, '../assets');
const OUT = join(import.meta.dirname, '../../../apps/web/public/brand');

// Where the Orb sits in each 1024px render (centre and diameter in pixels, measured
// from the particles' extent). The icons use the freestanding renders on ink, so the
// opacity boost below touches only the particles.
const RENDERS = {
  orbDark: { file: 'orb-dark.png', cx: 551, cy: 547, d: 686 },
  orbLight: { file: 'orb-light.png', cx: 551.5, cy: 547.5, d: 685 },
} as const;
type Render = (typeof RENDERS)[keyof typeof RENDERS];

const dataUri = (mime: string, data: Uint8Array | Buffer) =>
  `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
const source = (r: Render) => dataUri('image/png', readFileSync(join(ASSETS, r.file)));
const png = (svg: string, size: number) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

// The render placed so its Orb is centred and `fraction` of the canvas wide; optional
// background and corner radius (share of the size) for app tiles. The particles are
// about a pixel each at 1024px: scaled down they average with the transparent canvas and
// fade, so their opacity is raised by the inverse of the scale (at most 5×) to keep
// the Orb as vivid as at full size.
function orbPng(r: Render, size: number, fraction: number, background?: string, radius = 0) {
  const scale = (fraction * size) / r.d;
  const boost = Math.min(5, Math.max(1, 1.1 / scale));
  const x = size / 2 - r.cx * scale;
  const y = size / 2 - r.cy * scale;
  const rx = radius * size;
  const clip = radius ? ' clip-path="url(#t)"' : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    (radius
      ? `<clipPath id="t"><rect width="${size}" height="${size}" rx="${rx}"/></clipPath>`
      : '') +
    `<filter id="b" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="linear" slope="${boost}"/></feComponentTransfer></filter>` +
    `<g${clip}>` +
    (background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '') +
    `<image href="${source(r)}" x="${x}" y="${y}" width="${1024 * scale}" height="${1024 * scale}" filter="url(#b)"/>` +
    `</g></svg>`;
  return png(svg, size);
}

function ico(images: { size: number; data: Uint8Array }[]): Uint8Array {
  const header = 6 + images.length * 16;
  const total = header + images.reduce((sum, i) => sum + i.data.length, 0);
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

// The Orb fills this share of a free-standing image (a little room for stray particles).
const ORB_FRACTION = 0.94;
const orbImage = (r: Render, size: number): OrbImage => ({
  href: dataUri('image/png', orbPng(r, size, ORB_FRACTION)),
  fraction: ORB_FRACTION,
});

mkdirSync(OUT, { recursive: true });
const write = (name: string, data: string | Uint8Array) => writeFileSync(join(OUT, name), data);

// App icons: the particle Orb, centred and large. iOS rounds apple-touch-icon itself,
// so it is square; the launcher PNGs are rounded tiles; the maskable one keeps the Orb
// inside the 80% safe zone on a full-bleed background.
write('apple-touch-icon.png', orbPng(RENDERS.orbDark, 180, 0.7, ORB.ink));
write('icon-192.png', orbPng(RENDERS.orbDark, 192, 0.68, ORB.ink, 0.225));
write('icon-512.png', orbPng(RENDERS.orbDark, 512, 0.68, ORB.ink, 0.225));
write('icon-maskable-512.png', orbPng(RENDERS.orbDark, 512, 0.46, ORB.ink));

// Tab icons: the vector disc.
write('favicon.svg', faviconSvg());
write(
  'favicon.ico',
  ico([16, 32, 48].map((size) => ({ size, data: png(markSvg('bare-dark'), size) }))),
);
write('mark.svg', markSvg('tile-dark'));
write('mark-light.svg', markSvg('tile-light'));
write('mark-bare-light.svg', markSvg('bare-light'));
write('mark-bare-dark.svg', markSvg('bare-dark'));
write('mark-mono.svg', markSvg('mono'));

// The particle Orb for the UI (sign-in panel, About): freestanding, for dark and light.
write('orb-dark.png', orbPng(RENDERS.orbDark, 320, ORB_FRACTION));
write('orb-light.png', orbPng(RENDERS.orbLight, 320, ORB_FRACTION));

for (const theme of ['dark', 'light'] as const) {
  write(`wordmark-${theme}.svg`, wordmarkSvg('full', theme));
  write(`wordmark-compact-${theme}.svg`, wordmarkSvg('compact', theme));
  const orb = orbImage(theme === 'dark' ? RENDERS.orbDark : RENDERS.orbLight, 160);
  write(`lockup-${theme}.svg`, lockupSvg(theme, orb));
}
const preview = socialPreviewSvg(orbImage(RENDERS.orbDark, 320));
write('social-preview.svg', preview);
write('social-preview.png', png(preview, 1280));

// The mail header's inline Orb: 72px for 36 CSS pixels on a 2× screen, on the ink bar.
const mailOrb = orbPng(RENDERS.orbDark, 72, 0.92, ORB.ink);
writeFileSync(
  join(import.meta.dirname, '../src/mail-orb.ts'),
  `// Generated by scripts/build-assets.ts: the mail header's Orb (72px PNG, base64).\nexport const MAIL_ORB_PNG =\n  '${Buffer.from(mailOrb).toString('base64')}';\n`,
);
console.log(`brand files written to ${OUT}`);
