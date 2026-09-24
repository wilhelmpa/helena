import {
  ANSI_BLOCKS,
  ANSI_COMPACT,
  ANSI_FULL,
  HELENA_ANSI,
  renderAnsi,
  type AnsiArt,
  type AnsiGeometry,
} from './ansi';
import type { BrandVariant } from './config';
import {
  MONOGRAM,
  SPARK,
  TORCH,
  echoLayers,
  pixelLayers,
  type MarkColor,
  type PixelMap,
} from './pixel';

// What each variant draws, as data the web components, the icon build and the mails
// render from, so every place shows the same drawing.

export const MARK_GRID = 16;
// The tile's corner radius in grid pixels (a rounded square like an app icon).
export const MARK_RADIUS = 3.25;

const MARK_ART: Record<BrandVariant, { map: PixelMap; echo: boolean }> = {
  fackel: { map: TORCH, echo: true },
  monogramm: { map: MONOGRAM, echo: false },
  funke: { map: SPARK, echo: true },
};

export interface MarkLayer {
  color: MarkColor;
  d: string;
  // Hairlines of the Hermes shadow; drawn under the pixels.
  echo?: boolean;
}

// The mark's art on the 16-pixel grid, without its tile. `large` adds the shadow
// hairlines where the variant has them; use it from 64px up.
export function markLayers(variant: BrandVariant, detail: 'small' | 'large'): MarkLayer[] {
  const { map, echo } = MARK_ART[variant];
  const echoes =
    detail === 'large' && echo ? echoLayers(map).map((l) => ({ ...l, echo: true })) : [];
  return [...echoes, ...pixelLayers(map)];
}

// The wordmark's sizes: `compact` for the app's chrome (sidebar, headers: about 16–24px
// tall), `full` for the sign-in panel, the social preview and anything 40px and taller.
export type WordmarkSize = 'compact' | 'full';

// How a wordmark is coloured: `bands` in the gold/amber/bronze bands of the theme,
// `text` in the surrounding text colour (currentColor).
export type WordmarkTone = 'bands' | 'text';

export type WordmarkArt =
  | { kind: 'ansi'; art: AnsiArt; tone: WordmarkTone }
  // Set in a typeface; the web renders it as text in that font.
  | { kind: 'type'; text: string; font: 'dm-sans'; tone: WordmarkTone };

const WORDMARK: Record<BrandVariant, Record<WordmarkSize, () => WordmarkArt>> = {
  fackel: {
    compact: () => ansi(ANSI_COMPACT, 'bands'),
    full: () => ansi(ANSI_FULL, 'bands'),
  },
  monogramm: {
    compact: () => ansi({ ...ANSI_BLOCKS, cell: [3, 7] }, 'text'),
    full: () => ansi(ANSI_BLOCKS, 'bands'),
  },
  funke: {
    compact: () => ({ kind: 'type', text: 'Helena', font: 'dm-sans', tone: 'text' }),
    full: () => ({ kind: 'type', text: 'Helena', font: 'dm-sans', tone: 'text' }),
  },
};

function ansi(geometry: AnsiGeometry, tone: WordmarkTone): WordmarkArt {
  return { kind: 'ansi', art: renderAnsi(HELENA_ANSI, geometry), tone };
}

const cache = new Map<string, WordmarkArt>();
export function wordmarkArt(variant: BrandVariant, size: WordmarkSize): WordmarkArt {
  const key = `${variant}:${size}`;
  let art = cache.get(key);
  if (!art) {
    art = WORDMARK[variant][size]();
    cache.set(key, art);
  }
  return art;
}
