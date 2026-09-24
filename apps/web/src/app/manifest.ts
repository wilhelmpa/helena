import type { MetadataRoute } from 'next';
import { BRAND_ASSETS } from '@/components/brand/assets';
import { APP_NAME, THEME_COLOR_LIGHT } from '@/utils/app';

// The install manifest. The icons are the Helena mark of the brand variant
// (packages/brand, public/brand/<variant>): the SVG for any size, PNGs for launchers
// that want a raster, and a maskable one whose art sits inside the 80% safe zone so a
// round or squircle mask never cuts it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    start_url: '/',
    display: 'standalone',
    background_color: THEME_COLOR_LIGHT,
    theme_color: THEME_COLOR_LIGHT,
    icons: [
      { src: BRAND_ASSETS.favicon, sizes: 'any', type: 'image/svg+xml' },
      { src: BRAND_ASSETS.icon192, sizes: '192x192', type: 'image/png' },
      { src: BRAND_ASSETS.icon512, sizes: '512x512', type: 'image/png' },
      {
        src: BRAND_ASSETS.iconMaskable,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
