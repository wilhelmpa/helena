import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Providers } from '@/components/providers';
import RuntimeEnvScript from '@/components/runtime-env-script';
import WhatsNew from '@/features/whats-new/WhatsNew';
import { localeDirection, type Locale } from '@/i18n/locales';
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '@/utils/app';
import './globals.css';
import WorkspaceToolsProvider from './WorkspaceToolsProvider';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('title'), description: t('description') };
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

  return (
    <html
      lang={locale}
      dir={localeDirection(locale as Locale)}
      // Geist and Geist Mono, self-hosted by next/font (no request to a font CDN);
      // globals.css maps the two variables onto --font-sans/--font-mono.
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <RuntimeEnvScript />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          // A distinct key: next-themes defaults to "theme", which collides with any
          // other app sharing the same localhost origin. A shared key makes two such
          // apps fight over the value through cross-tab storage events.
          storageKey="itsaplan-theme"
        >
          <NextIntlClientProvider>
            <Providers>
              <WorkspaceToolsProvider>{children}</WorkspaceToolsProvider>
              <WhatsNew />
            </Providers>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
