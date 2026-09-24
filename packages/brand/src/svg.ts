import { MARK_GRID, MARK_RADIUS, markLayers, wordmarkArt, type WordmarkSize } from './art';
import { BANDS, TILE, type BrandTheme } from './palette';

// Standalone SVG files of the brand (public/brand, the icons, the README): the same
// drawings the web components render inline, with the colours written out.

const svg = (viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Helena">${body}</svg>\n`;

export interface MarkSvgOptions {
  // small: crisp pixels only (16–48px); large: with the shadow hairlines (64px up).
  detail: 'small' | 'large';
  // tile: the rounded ink square (favicon, "any" icons); bleed: the ink fills the whole
  // square and the platform cuts its own shape (apple-touch-icon, maskable).
  frame: 'tile' | 'bleed';
  // Empty grid pixels around the 16-pixel art, for icons whose art must sit inside a
  // safe zone.
  pad?: number;
}

// The mark's art as SVG elements in grid units (origin at the art's corner).
function markBody(detail: 'small' | 'large'): string {
  return markLayers(detail)
    .map((l) => `<path fill="${BANDS.dark[l.color]}" d="${l.d}"/>`)
    .join('');
}

export function markSvg(options: MarkSvgOptions): string {
  const pad = options.pad ?? 0;
  const size = MARK_GRID + pad * 2;
  const rx = options.frame === 'tile' ? ` rx="${MARK_RADIUS * (size / MARK_GRID)}"` : '';
  const tile = `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}"${rx} fill="${TILE}"/>`;
  // Small renderings snap the pixels to the device grid; the tile keeps smooth corners.
  const art = markBody(options.detail);
  const body = options.detail === 'small' ? `<g shape-rendering="crispEdges">${art}</g>` : art;
  return svg(`${-pad} ${-pad} ${size} ${size}`, tile + body);
}

// The wordmark's paths, coloured for a dark or a light background.
function wordmarkBody(size: WordmarkSize, theme: BrandTheme) {
  const art = wordmarkArt(size);
  const body = art.rows
    .map((row) => `<path fill="${BANDS[theme][row.band]}" d="${row.d}"/>`)
    .join('');
  // The letters are the first five rows; ANSI Shadow's last row is shadow only.
  return { body, width: art.width, height: art.height, letterHeight: (art.height * 5) / 6 };
}

export function wordmarkSvg(size: WordmarkSize, theme: BrandTheme): string {
  const { body, width, height } = wordmarkBody(size, theme);
  return svg(`0 0 ${width} ${height}`, body);
}

// Mark and full wordmark side by side as SVG elements; the mark is a little taller than
// the letters and centred on them, the wordmark follows after a sixth of the mark.
function lockupBody(theme: BrandTheme) {
  const word = wordmarkBody('full', theme);
  const markSize = word.letterHeight * 1.18;
  const gap = markSize / 6;
  const markY = (word.letterHeight - markSize) / 2;
  const tile = `<rect width="${MARK_GRID}" height="${MARK_GRID}" rx="${MARK_RADIUS}" fill="${TILE}"/>`;
  const body =
    `<g transform="translate(0 ${markY}) scale(${markSize / MARK_GRID})">${tile}${markBody('large')}</g>` +
    `<g transform="translate(${markSize + gap} 0)">${word.body}</g>`;
  return { body, width: markSize + gap + word.width, top: markY, bottom: word.height };
}

// The lockup on a transparent background, for a dark or a light page (README header).
export function lockupSvg(theme: BrandTheme): string {
  const l = lockupBody(theme);
  return svg(`0 ${l.top} ${l.width} ${l.bottom - l.top}`, l.body);
}

// The social preview (GitHub, link unfurls): the lockup on the ink, 1280 × 640, with the
// tagline. The type is live text in Inter and JetBrains Mono, so its PNG is rendered in a
// browser that has both (packages/brand/scripts/build-assets.ts says how).
export function socialPreviewSvg(): string {
  const l = lockupBody('dark');
  const scale = 2.2;
  const x = (1280 - l.width * scale) / 2;
  const body =
    `<rect width="1280" height="640" fill="${TILE}"/>` +
    `<g transform="translate(${x} 196) scale(${scale})">${l.body}</g>` +
    `<text x="640" y="470" text-anchor="middle" font-family="InterVariable, Inter, sans-serif" font-size="30" font-weight="500" fill="#CFC6B8">Mission control for your AI agents</text>` +
    `<text x="640" y="596" text-anchor="middle" font-family="'JetBrains Mono Variable', 'JetBrains Mono', monospace" font-size="14" fill="#7D7466">self-hosted · open source · runs on Hermes Agent</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640" role="img" aria-label="Helena">${body}</svg>\n`;
}
