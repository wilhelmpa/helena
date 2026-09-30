// Colours of the retired ANSI Shadow wordmark. tokens.css still carries them as
// --helena-gold/-amber/-bronze (brandTokens.test.ts keeps both in step).
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

// The Orb is the app's voice orb in its speaking state. Icons and large marks use the
// particle renders in packages/brand/assets; at 48px and below particles are only
// noise, so a vector disc in the same gradient (violet lower left, pink upper right)
// stands for it. `ink` is the renders' background.
export const ORB = {
  ink: '#121016',
  paper: '#F6F4EF',
  text: '#1B1B1F',
  onDark: ['#6C4CF5', '#B356DC', '#FF5C9E'],
  onLight: ['#3A2BE8', '#8A2BBF', '#E0306B'],
} as const;

// Kept for the existing ink token in tokens.css.
export const TILE = HERMES.ink;
