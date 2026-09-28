import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Providers } from '@/components/providers';
import RuntimeEnvScript from '@/components/runtime-env-script';
import { localeDirection, type Locale } from '@/i18n/locales';
import { BRAND_ASSETS } from '@/components/brand/assets';
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '@/utils/app';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return {
    title: t('title'),
    description: t('description'),
    // The brand's icons (packages/brand): the SVG for browsers that take one, the .ico
    // (16/32/48) for the rest, and the home-screen icon.
    icons: {
      icon: [
        { url: BRAND_ASSETS.favicon, type: 'image/svg+xml' },
        { url: BRAND_ASSETS.faviconIco, sizes: '16x16 32x32 48x48' },
      ],
      apple: { url: BRAND_ASSETS.appleTouchIcon, sizes: '180x180' },
    },
  };
}

// The page reaches under the notch and the home indicator (viewport-fit=cover); the
// shell pads itself back with the safe-area insets where it meets an edge. The theme
// color follows the page background, so the phone's status bar blends into it.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_DARK },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  // The script nonce of this request (src/proxy.ts), for next-themes' inline bootstrap.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang={locale} dir={localeDirection(locale as Locale)} suppressHydrationWarning>
      <body className="antialiased">
        {/* React hoists it into <head>. use-credentials: see app/manifest.webmanifest. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <RuntimeEnvScript />
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          // A distinct key: next-themes defaults to "theme", which collides with any
          // other app sharing the same localhost origin. A shared key makes two such
          // apps fight over the value through cross-tab storage events.
          storageKey="itsaplan-theme"
          nonce={nonce}
        >
          <NextIntlClientProvider>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
