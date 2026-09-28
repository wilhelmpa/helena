'use client';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/core/client';
import { BrowserControlError } from '@/utils/browserControl';
import { localeDirection, type Locale } from '@/i18n/locales';
import { HotkeysProvider } from '@/context/useHotkeys';
import { SyncProvider } from '@/context/syncContext';
import { RelativeTimeProvider } from '@/context/relativeTimeContext';
import { Toaster } from '@/components/ui/sonner';
import PreferencesSync from '@/components/preferences-sync';
import SessionScope from '@/components/session-scope';
import PushSync from '@/features/push/components/PushSync';
import HomeAutoConnect from '@/features/home-access/HomeAutoConnect';
import LanAccessExpiry from '@/features/home-access/LanAccessExpiry';
import { SessionProvider } from '@/lib/auth-client';

// The message shown for a failed mutation: the API's error worded in the reader's
// language when it carries a code this app knows (common.apiErrors), else the API's
// `{ error }` text (carried by ApiError), otherwise a generic fallback.
function errorMessage(
  error: unknown,
  fallback: string,
  browser: (code: BrowserControlError['code']) => string,
  api: (code: string | undefined) => string | undefined,
): string {
  if (error instanceof BrowserControlError) return browser(error.code);
  if (error instanceof ApiError) return api(error.code) ?? error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function Providers({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  // Radix reads the direction from this context, not from the CSS: without it a
  // menu keeps left-to-right arrow-key navigation and alignment even once the
  // layout is mirrored.
  const dir = localeDirection(useLocale() as Locale);
  // The cache is built once, so the toast reads the fallback through a ref the
  // render refreshes; switching locale then reaches errors too.
  const fallback = useRef(t('genericError'));
  fallback.current = t('genericError');
  // Browser errors come as codes (utils/browserControl.ts), worded in the reader's language.
  const tBrowser = useTranslations('browserGateway.errors');
  const browserError = useRef((code: BrowserControlError['code']) => tBrowser(code));
  useEffect(() => {
    browserError.current = (code) => tBrowser(code);
  }, [tBrowser]);
  const tApi = useTranslations('common.apiErrors');
  const apiError = useRef<(code: string | undefined) => string | undefined>(() => undefined);
  useEffect(() => {
    apiError.current = (code) => {
      const key = code as Parameters<typeof tApi>[0];
      return code && tApi.has(key) ? tApi(key) : undefined;
    };
  }, [tApi]);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Every failed mutation is surfaced as a toast, so no call site has to wire
        // its own error UI. A mutation that owns its error display can opt out with
        // `meta: { suppressErrorToast: true }`. Reads are not toasted — a failed
        // query renders its own empty/loading state in place.
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            if (mutation.meta?.suppressErrorToast) return;
            toast.error(
              errorMessage(error, fallback.current, browserError.current, apiError.current),
            );
          },
        }),
        defaultOptions: {
          // A short stale time avoids redundant refetches on tab switches while
          // edits still show immediately (mutations invalidate). Window-focus
          // refetch picks up changes made by other clients on return to the tab.
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Direction.Provider dir={dir}>
        <SessionProvider>
          <SessionScope />
          <PreferencesSync />
          <PushSync />
          <HomeAutoConnect />
          <LanAccessExpiry />
          <SyncProvider>
            <RelativeTimeProvider>
              <HotkeysProvider>{children}</HotkeysProvider>
            </RelativeTimeProvider>
          </SyncProvider>
          <Toaster position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'} dir={dir} richColors />
        </SessionProvider>
      </Direction.Provider>
    </QueryClientProvider>
  );
}
