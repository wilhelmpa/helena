// The wordmark keeps its established ANSI Shadow bands.
export const HERMES = {
  gold: '#FFD700',
  amber: '#FFBF00',
  bronze: '#CD7F32',
  ink: '#141414',
} as const;

export const BANDS = {
  dark: { gold: HERMES.gold, amber: HERMES.amber, bronze: HERMES.bronze },
  light: { gold: '#9A7000', amber: '#A85A00', bronze: '#8A4516' },
} as const;

export type BandColor = keyof typeof BANDS.dark;
export type BrandTheme = keyof typeof BANDS;

// Orb colours are independent of the product name and of the ANSI wordmark.
export const ORB = {
  tileLight: '#1B1B1F',
  tileDark: '#2A2A31',
  ring: '#E8A33D',
  core: '#F2C14E',
  paper: '#F6F4EF',
} as const;

// Kept for the existing wordmark tokens; the Orb itself uses ORB.tileLight/Dark.
export const TILE = HERMES.ink;
