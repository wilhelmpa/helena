// The one switch for Helena's logo and type (owner decision pending, 2026-09-24).
// Everything that shows the brand reads these two constants: the sidebar, the sign-in
// panel, the shared-page header, the favicon and app icons, the install manifest and
// the header of Helena's mails. Changing a value here and running
// `bun run --cwd packages/brand build:assets` is the whole switch.

// The logo variants, all drawn in Hermes Agent's style (its CLI banner: ANSI Shadow
// block capitals in gold, amber and bronze bands with a double-line shadow), so the two
// read as siblings:
//   fackel     Helena's torch as the mark (Hermes carries the caduceus, Helena the
//              torch: "Helena" means the bright one) and HELENA in the same ANSI Shadow
//              capitals as HERMES-AGENT, banded, with the double-line shadow.
//   monogramm  The calm one: a pixel H as the mark and HELENA in plain blocks of one
//              colour (the text colour) in the app; bands only at large sizes.
//   funke      The current mark's idea (two pillars joined by a spark) redrawn in
//              pixels, with "Helena" set in DM Sans, the type of Hermes' website.
export const BRAND_VARIANTS = ['fackel', 'monogramm', 'funke'] as const;
export type BrandVariant = (typeof BRAND_VARIANTS)[number];

// The UI typeface. `inter` keeps the owner's standard (Inter everywhere, the sidebar's
// face); `dm-sans` sets the UI in DM Sans like Hermes' website. JetBrains Mono is the
// code face in both. The sizes (13/12/14/16 px) stay the same either way.
export const BRAND_UI_FONTS = ['inter', 'dm-sans'] as const;
export type BrandUiFont = (typeof BRAND_UI_FONTS)[number];

export const BRAND_VARIANT: BrandVariant = 'fackel';
export const BRAND_UI_FONT: BrandUiFont = 'inter';
