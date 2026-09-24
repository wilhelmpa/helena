import { MARK_GRID, MARK_RADIUS, markLayers, wordmarkArt, type WordmarkSize } from './art';
import type { BrandVariant } from './config';
import { BANDS, MARK_COLORS, TILE, type BrandTheme } from './palette';

// Standalone SVG files of the brand (public/brand, the icons, the README): the same
// drawings the web components render inline, with the colours written out.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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

// The mark's art and tile as SVG elements in grid units (origin at the art's corner).
export function markBody(variant: BrandVariant, detail: 'small' | 'large'): string {
  return markLayers(variant, detail)
    .map((l) => `<path fill="${MARK_COLORS[l.color]}" d="${l.d}"/>`)
    .join('');
}

export function markSvg(variant: BrandVariant, options: MarkSvgOptions): string {
  const pad = options.pad ?? 0;
  const size = MARK_GRID + pad * 2;
  const tile =
    options.frame === 'tile'
      ? `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" rx="${MARK_RADIUS * (size / MARK_GRID)}" fill="${TILE}"/>`
      : `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" fill="${TILE}"/>`;
  // Small renderings snap the pixels to the device grid; the tile keeps its smooth corners.
  const art = markBody(variant, options.detail);
  const body = options.detail === 'small' ? `<g shape-rendering="crispEdges">${art}</g>` : art;
  return svg(`${-pad} ${-pad} ${size} ${size}`, tile + body);
}

// The wordmark on its own, coloured for a dark or a light background.
export function wordmarkSvg(variant: BrandVariant, size: WordmarkSize, theme: BrandTheme): string {
  const { body, width, height } = wordmarkBody(variant, size, theme);
  return svg(`0 0 ${width} ${height}`, body);
}

export function wordmarkBody(
  variant: BrandVariant,
  size: WordmarkSize,
  theme: BrandTheme,
): { body: string; width: number; height: number; letterHeight: number } {
  const w = wordmarkArt(variant, size);
  const text = theme === 'dark' ? '#F4EFE6' : '#2A2622';
  if (w.kind === 'type') {
    // DM Sans SemiBold, cap height ≈ 0.7em: 100 units of cap height need ~143px type.
    const fontSize = 143;
    return {
      width: 430,
      height: 110,
      letterHeight: 100,
      body: `<text x="0" y="104" font-family="'DM Sans Variable','DM Sans',sans-serif" font-weight="650" font-size="${fontSize}" letter-spacing="-4" fill="${text}">${esc(w.text)}</text>`,
    };
  }
  const body = w.art.rows
    .map(
      (row) => `<path fill="${w.tone === 'text' ? text : BANDS[theme][row.band]}" d="${row.d}"/>`,
    )
    .join('');
  // The letters are the rows with blocks; ANSI Shadow's last row is shadow only.
  const letterRows = w.art.rows.length === 6 ? 5 : w.art.rows.length;
  const letterHeight = (w.art.height * letterRows) / w.art.rows.length;
  return { body, width: w.art.width, height: w.art.height, letterHeight };
}

// Whether the mark stands beside the wordmark (sidebar, sign-in panel, lockups) or only
// on its own (favicon, app icons, the collapsed sidebar).
export function hasLockupMark(variant: BrandVariant): boolean {
  return variant !== 'monogramm';
}

// Mark and wordmark side by side (README header, social preview), on a transparent
// background, for a dark or a light page.
export function lockupSvg(variant: BrandVariant, theme: BrandTheme): string {
  const word = wordmarkBody(variant, 'full', theme);
  // The monogram is the wordmark's own first letter: beside the wordmark it would read
  // "H HELENA", so that variant's lockup is the wordmark alone.
  if (!hasLockupMark(variant)) return svg(`0 0 ${word.width} ${word.height}`, word.body);
  // The mark is as tall as the wordmark's letters (its blocks), the wordmark follows
  // after a gap of a third of the mark.
  const { letterHeight } = word;
  const markSize = letterHeight * 1.18;
  const scale = markSize / MARK_GRID;
  const gap = markSize / 3;
  const width = markSize + gap + word.width;
  const height = Math.max(markSize, word.height);
  const markY = (letterHeight - markSize) / 2;
  const tile = `<rect width="${MARK_GRID}" height="${MARK_GRID}" rx="${MARK_RADIUS}" fill="${TILE}"/>`;
  const body =
    `<g transform="translate(0 ${markY}) scale(${scale})">${tile}${markBody(variant, 'large')}</g>` +
    `<g transform="translate(${markSize + gap} 0)">${word.body}</g>`;
  return svg(`0 ${Math.min(0, markY)} ${width} ${height - Math.min(0, markY)}`, body);
}
