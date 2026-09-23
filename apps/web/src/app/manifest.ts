import type { MetadataRoute } from 'next';
import { APP_NAME } from '@/utils/app';

// The install manifest. The icons are the Helena mark (public/brand, see the logo files
// there): the SVG for any size, PNGs for launchers that want a raster, and a maskable one
// whose glyph sits inside the 80% safe zone so a round or squircle mask never cuts it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    start_url: '/',
    display: 'standalone',
    background_color: '#fbfaf7',
    theme_color: '#fbfaf7',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/brand/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
