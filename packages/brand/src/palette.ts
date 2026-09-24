// Hermes Agent's colours (hermes_cli/banner.py and the skin engine): the banner's three
// bands top to bottom, its dim accent, and the near-black the banner is drawn on.
export const HERMES = {
  gold: '#FFD700',
  amber: '#FFBF00',
  bronze: '#CD7F32',
  dim: '#B8860B',
  // The banner's text colour; the light accent of a mark.
  cornsilk: '#FFF8DC',
  ink: '#141414',
} as const;

// The bands of a wordmark, per theme. On a dark surface they are Hermes' own colours.
// On the light paper surface Hermes' gold is unreadable (1.4:1), so the bands turn to
// the same three hues darkened until each passes 3:1 for graphics on the page and the
// sidebar (Hermes' website does the same: #8B6508 for its gold in light mode).
export const BANDS = {
  dark: { gold: HERMES.gold, amber: HERMES.amber, bronze: HERMES.bronze },
  light: { gold: '#9A7000', amber: '#A85A00', bronze: '#8A4516' },
} as const;

export type BandColor = keyof typeof BANDS.dark;
export type BrandTheme = keyof typeof BANDS;

// The mark always stands on the ink tile, in both themes, so its art keeps Hermes'
// bright colours everywhere.
export const TILE = HERMES.ink;
export const MARK_COLORS = { ...BANDS.dark, light: HERMES.cornsilk } as const;
