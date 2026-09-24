import { ANSI_COMPACT, ANSI_FULL, HELENA_ANSI, renderAnsi, type AnsiArt } from './ansi';
import type { BandColor } from './palette';
import { TORCH, echoLayers, pixelLayers } from './pixel';

// What the brand draws, as data the web components, the icon build and the mails render
// from, so every place shows the same drawing (owner decision 2026-09-24: variant
// "Fackel" — Helena's torch and HELENA in Hermes' ANSI Shadow lettering).

export const MARK_GRID = 16;
// The tile's corner radius in grid pixels (a rounded square like an app icon).
export const MARK_RADIUS = 3.25;

export interface MarkLayer {
  color: BandColor;
  d: string;
  // Hairlines of the Hermes shadow; drawn under the pixels.
  echo?: boolean;
}

// The torch on the 16-pixel grid, without its tile. `large` adds the shadow hairlines;
// use it from 64px up.
export function markLayers(detail: 'small' | 'large'): MarkLayer[] {
  const echoes = detail === 'large' ? echoLayers(TORCH).map((l) => ({ ...l, echo: true })) : [];
  return [...echoes, ...pixelLayers(TORCH)];
}

// The wordmark's sizes: `compact` for the app's chrome (sidebar, headers), one shadow
// line, 150 × 42 units; `full` for the sign-in panel, the social preview and anything
// 40px and taller, the double shadow line, 300 × 84 units.
export type WordmarkSize = 'compact' | 'full';

const WORDMARK: Record<WordmarkSize, AnsiArt> = {
  compact: renderAnsi(HELENA_ANSI, ANSI_COMPACT),
  full: renderAnsi(HELENA_ANSI, ANSI_FULL),
};

export function wordmarkArt(size: WordmarkSize): AnsiArt {
  return WORDMARK[size];
}
