import { ORB } from './palette';
import { WORDMARK_GLYPHS } from './wordmark-glyphs';

const svg = (viewBox: string, body: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${extra} role="img" aria-label="AVA">${body}</svg>\n`;
const n = (v: number) => String(Math.round(v * 100) / 100);

// ---------- The vector Orb (48px and below) ----------

export type MarkVariant = 'tile-dark' | 'tile-light' | 'bare-dark' | 'bare-light' | 'mono';
export type OrbScheme = 'dark' | 'light';

// Disc radius in the 100×100 grid: alone it fills most of the square, on a tile it
// keeps the tile's margin.
export const DISC_RADIUS = { bare: 44, tile: 31 } as const;

export function orbStops(scheme: OrbScheme): readonly string[] {
  return scheme === 'dark' ? ORB.onDark : ORB.onLight;
}

// Linear gradient from lower left to upper right, in the disc's bounding box.
export function discGradient(id: string, scheme: OrbScheme): string {
  const stops = orbStops(scheme);
  return (
    `<linearGradient id="${id}" x1="0.15" y1="0.85" x2="0.85" y2="0.15">` +
    stops
      .map((c, i) => `<stop offset="${n(i / (stops.length - 1))}" stop-color="${c}"/>`)
      .join('') +
    `</linearGradient>`
  );
}

export function discBody(variant: MarkVariant, id = 'ava-orb'): string {
  if (variant === 'mono')
    return `<circle cx="50" cy="50" r="${DISC_RADIUS.bare}" fill="currentColor"/>`;
  const tile = variant === 'tile-dark' ? ORB.ink : variant === 'tile-light' ? ORB.paper : null;
  const scheme: OrbScheme = variant.endsWith('light') ? 'light' : 'dark';
  const r = tile ? DISC_RADIUS.tile : DISC_RADIUS.bare;
  return (
    `<defs>${discGradient(id, scheme)}</defs>` +
    (tile ? `<rect width="100" height="100" rx="23" fill="${tile}"/>` : '') +
    `<circle cx="50" cy="50" r="${r}" fill="url(#${id})"/>`
  );
}

export function markSvg(variant: MarkVariant = 'tile-dark'): string {
  return svg('0 0 100 100', discBody(variant));
}

// The tab icon: the bare disc, deeper colours on a light browser, brighter on a dark one.
export function faviconSvg(): string {
  return svg(
    '0 0 100 100',
    `<style>.d{display:none}@media (prefers-color-scheme: dark){.l{display:none}.d{display:inline}}</style>` +
      `<g class="l">${discBody('bare-light', 'ava-l')}</g><g class="d">${discBody('bare-dark', 'ava-d')}</g>`,
  );
}

// ---------- Wordmark ----------

export type WordmarkSize = keyof typeof WORDMARK_GLYPHS;
export type WordmarkTheme = 'dark' | 'light' | 'mono';

const WORD_COLOR: Record<WordmarkTheme, string> = {
  dark: ORB.paper,
  light: ORB.text,
  mono: 'currentColor',
};

// The outlines' tight box in font units (cap height from y = -capHeight to the baseline).
export function wordmarkGeometry(size: WordmarkSize) {
  const g = WORDMARK_GLYPHS[size];
  const [x0, y0, x1, y1] = g.box;
  return {
    d: g.d,
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
    viewBox: `${n(x0)} ${n(y0)} ${n(x1 - x0)} ${n(y1 - y0)}`,
  };
}

export function wordmarkSvg(size: WordmarkSize, theme: WordmarkTheme): string {
  const g = wordmarkGeometry(size);
  return svg(g.viewBox, `<path fill="${WORD_COLOR[theme]}" d="${g.d}"/>`);
}

// ---------- Lockup and social preview (particle Orb) ----------

// A particle render as an image reference: `href` (a URL or data URI) and the share of
// the image's width the Orb's diameter fills, the Orb centred.
export interface OrbImage {
  href: string;
  fraction: number;
}

// Orb + wordmark as in the owner's reference: the Orb 1.3 cap heights across, centred
// on the capitals, 0.62 cap heights before the first letter.
export const LOCKUP = { orb: 1.3, gap: 0.62 } as const;

function lockupBody(theme: 'dark' | 'light', orb: OrbImage) {
  const g = wordmarkGeometry('full');
  const cap = -g.y;
  const d = cap * LOCKUP.orb;
  const size = d / orb.fraction;
  const cy = -cap / 2;
  const body =
    `<image href="${orb.href}" x="${n(d / 2 - size / 2)}" y="${n(cy - size / 2)}" width="${n(size)}" height="${n(size)}"/>` +
    `<path fill="${WORD_COLOR[theme]}" transform="translate(${n(d + cap * LOCKUP.gap - g.x)} 0)" d="${g.d}"/>`;
  return { body, x: 0, y: cy - d / 2, width: d + cap * LOCKUP.gap + g.width, height: d };
}

export function lockupSvg(theme: 'dark' | 'light', orb: OrbImage): string {
  const l = lockupBody(theme, orb);
  return svg(`${n(l.x)} ${n(l.y)} ${n(l.width)} ${n(l.height)}`, l.body);
}

// 1280×640 for link previews: the dark lockup on the renders' ink.
export function socialPreviewSvg(orb: OrbImage): string {
  const l = lockupBody('dark', orb);
  const scale = 620 / l.width;
  const x = (1280 - l.width * scale) / 2 - l.x * scale;
  const y = (640 - l.height * scale) / 2 - l.y * scale;
  return svg(
    '0 0 1280 640',
    `<rect width="1280" height="640" fill="${ORB.ink}"/><g transform="translate(${n(x)} ${n(y)}) scale(${scale})">${l.body}</g>`,
    ' width="1280" height="640"',
  );
}
