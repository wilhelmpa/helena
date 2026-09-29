import { ANSI_COMPACT, ANSI_FULL, HELENA_ANSI, renderAnsi, type AnsiArt } from './ansi';

// The ANSI wordmark remains the text companion to the name-independent Orb.
export type WordmarkSize = 'compact' | 'full';

const WORDMARK: Record<WordmarkSize, AnsiArt> = {
  compact: renderAnsi(HELENA_ANSI, ANSI_COMPACT),
  full: renderAnsi(HELENA_ANSI, ANSI_FULL),
};

export function wordmarkArt(size: WordmarkSize): AnsiArt {
  return WORDMARK[size];
}
