import { BRAND_ASSETS } from '@/components/brand/assets';
import { THEME_COLOR_LIGHT } from '@/utils/app';
import { getDisplayName } from '@/i18n/displayName';

// The install manifest. The icons are the particle Orb (packages/brand, public/brand):
// PNG tiles for launchers and a maskable one whose Orb sits inside the 80% safe zone so a
// round or squircle mask never cuts it. No SVG entry: the vector disc is for tab icons,
// and a launcher would prefer it over the Orb.
//
// A route rather than the app/manifest.ts convention, so the root layout can link it with
// crossorigin="use-credentials": behind Cloudflare Access a manifest requested without the
// Access cookie is sent to Access's login page, the browser refuses that (CSP) and the app
// cannot be installed from the public name.
//
// display_override: an installed Helena may hide its title bar (the browser offers a
// toggle); the window buttons then sit in Helena's header row (globals.css,
// "display-mode: window-controls-overlay"). Otherwise a normal app window.
export const dynamic = 'force-dynamic';

export async function GET() {
  const appName = await getDisplayName();
  return Response.json(
    {
      id: '/',
      name: appName,
      short_name: appName,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      display_override: ['window-controls-overlay', 'standalone'],
      background_color: THEME_COLOR_LIGHT,
      theme_color: THEME_COLOR_LIGHT,
      icons: [
        { src: BRAND_ASSETS.icon192, sizes: '192x192', type: 'image/png' },
        { src: BRAND_ASSETS.icon512, sizes: '512x512', type: 'image/png' },
        {
          src: BRAND_ASSETS.iconMaskable,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    {
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}
