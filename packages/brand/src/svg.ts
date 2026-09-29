import { wordmarkArt, type WordmarkSize } from './art';
import { BANDS, ORB, type BrandTheme } from './palette';

const svg = (viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Helena">${body}</svg>\n`;

export type OrbVariant = 'tile-light' | 'tile-dark' | 'bare-light' | 'bare-dark' | 'mono';
export type OrbDetail = 'small' | 'regular';

export const ORB_GRID = 100;
export const ORB_RADIUS = 23;

export function orbGeometry(detail: OrbDetail) {
  return detail === 'small'
    ? { stroke: 9, core: 11, satellite: 7.5 }
    : { stroke: 7, core: 10, satellite: 6.5 };
}

export interface MarkSvgOptions {
  variant?: OrbVariant;
  detail?: OrbDetail;
  // Percentage of the output edge reserved on each side for maskable icons.
  inset?: number;
}

export function orbBody(variant: OrbVariant, detail: OrbDetail): string {
  const { stroke, core, satellite } = orbGeometry(detail);
  const mono = variant === 'mono';
  const ring = mono ? 'currentColor' : ORB.ring;
  const center = mono ? 'currentColor' : ORB.core;
  const dot = mono ? 'currentColor' : variant === 'bare-light' ? ORB.tileLight : ORB.paper;
  const tile =
    variant === 'tile-light' || variant === 'tile-dark'
      ? `<rect x="0" y="0" width="100" height="100" rx="23" fill="${variant === 'tile-dark' ? ORB.tileDark : ORB.tileLight}"/>`
      : '';
  return (
    tile +
    `<circle cx="50" cy="52" r="23" fill="none" stroke="${ring}" stroke-width="${stroke}"/>` +
    `<circle cx="50" cy="52" r="${core}" fill="${center}"/>` +
    `<circle cx="72" cy="30" r="${satellite}" fill="${dot}"/>`
  );
}

export function markSvg({
  variant = 'tile-light',
  detail = 'regular',
  inset = 0,
}: MarkSvgOptions = {}): string {
  if (!inset) return svg('0 0 100 100', orbBody(variant, detail));
  const background = variant === 'tile-dark' ? ORB.tileDark : ORB.tileLight;
  const art = orbBody('bare-dark', detail);
  return svg(
    '0 0 100 100',
    `<rect width="100" height="100" fill="${background}"/><g transform="translate(${inset} ${inset}) scale(${(100 - 2 * inset) / 100})">${art}</g>`,
  );
}

export function faviconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Helena"><style>.dark { display: none } @media (prefers-color-scheme: dark) { .light { display: none } .dark { display: inline } }</style><g class="light">${orbBody('tile-light', 'small')}</g><g class="dark">${orbBody('tile-dark', 'small')}</g></svg>\n`;
}

function wordmarkBody(size: WordmarkSize, theme: BrandTheme) {
  const art = wordmarkArt(size);
  const body = art.rows
    .map((row) => `<path fill="${BANDS[theme][row.band]}" d="${row.d}"/>`)
    .join('');
  return { body, width: art.width, height: art.height, letterHeight: (art.height * 5) / 6 };
}

export function wordmarkSvg(size: WordmarkSize, theme: BrandTheme): string {
  const { body, width, height } = wordmarkBody(size, theme);
  return svg(`0 0 ${width} ${height}`, body);
}

function lockupBody(theme: BrandTheme) {
  const word = wordmarkBody('full', theme);
  const markSize = word.letterHeight * 1.18;
  const gap = markSize / 6;
  const markY = (word.letterHeight - markSize) / 2;
  const body =
    `<g transform="translate(0 ${markY}) scale(${markSize / ORB_GRID})">${orbBody(theme === 'dark' ? 'tile-dark' : 'tile-light', 'regular')}</g>` +
    `<g transform="translate(${markSize + gap} 0)">${word.body}</g>`;
  return { body, width: markSize + gap + word.width, top: markY, bottom: word.height };
}

export function lockupSvg(theme: BrandTheme): string {
  const l = lockupBody(theme);
  return svg(`0 ${l.top} ${l.width} ${l.bottom - l.top}`, l.body);
}

export function socialPreviewSvg(): string {
  const l = lockupBody('dark');
  const scale = 2.2;
  const x = (1280 - l.width * scale) / 2;
  const body =
    `<rect width="1280" height="640" fill="${ORB.tileDark}"/>` +
    `<g transform="translate(${x} 196) scale(${scale})">${l.body}</g>` +
    `<text x="640" y="470" text-anchor="middle" font-family="InterVariable, Inter, sans-serif" font-size="30" font-weight="500" fill="#CFC6B8">Mission control for your AI agents</text>` +
    `<text x="640" y="596" text-anchor="middle" font-family="'JetBrains Mono Variable', 'JetBrains Mono', monospace" font-size="14" fill="#7D7466">self-hosted · open source · runs on Hermes Agent</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640" role="img" aria-label="Helena">${body}</svg>\n`;
}
