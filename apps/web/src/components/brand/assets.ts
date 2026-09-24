import { BRAND_VARIANT } from '@helena/brand';

// The brand's files in public/brand/<variant>/, written by
// `bun run --cwd packages/brand build:assets` for every variant; the variant switch in
// packages/brand picks the folder, so the favicon, the app icons and the manifest
// follow it with the rest of the brand.
const base = `/brand/${BRAND_VARIANT}`;

export const BRAND_ASSETS = {
  favicon: `${base}/favicon.svg`,
  faviconIco: `${base}/favicon.ico`,
  appleTouchIcon: `${base}/apple-touch-icon.png`,
  icon192: `${base}/icon-192.png`,
  icon512: `${base}/icon-512.png`,
  iconMaskable: `${base}/icon-maskable-512.png`,
} as const;
