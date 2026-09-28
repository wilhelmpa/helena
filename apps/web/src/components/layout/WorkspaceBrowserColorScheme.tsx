'use client';

import { useEffect, useRef, useState } from 'react';
import { Moon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type BrowserColorMode = 'helena' | 'light';

export function useBrowserColorScheme(base: string | null, theme?: string, resolvedTheme?: string) {
  const [setting, setSetting] = useState<{ base: string; mode: BrowserColorMode } | null>(null);
  const mode = setting?.base === base ? setting.mode : 'helena';
  const loaded = base !== null && setting?.base === base;
  const pending = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    void fetch(`${base}/color-scheme`, { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Browser settings unavailable');
        return response.json() as Promise<{ mode?: BrowserColorMode }>;
      })
      .then((setting) => {
        if (!cancelled) {
          setSetting({ base, mode: setting?.mode === 'light' ? 'light' : 'helena' });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base]);

  useEffect(() => {
    if (
      !base ||
      !loaded ||
      !['light', 'dark', 'system'].includes(theme ?? '') ||
      !['light', 'dark'].includes(resolvedTheme ?? '')
    )
      return;
    // A rapid theme change must reach the shared project browser in the same order.
    pending.current = pending.current
      .then(() =>
        fetch(`${base}/color-scheme`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode, theme, resolvedTheme }),
        }),
      )
      .catch(() => {});
  }, [base, loaded, mode, theme, resolvedTheme]);

  return {
    mode,
    loaded,
    setMode: (next: BrowserColorMode) => {
      if (base) setSetting({ base, mode: next });
    },
  };
}

export default function WorkspaceBrowserColorScheme({
  mode,
  loaded,
  onModeChange,
}: {
  mode: BrowserColorMode;
  loaded: boolean;
  onModeChange: (mode: BrowserColorMode) => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={mode === 'light' ? 'secondary' : 'ghost'}
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          title={t('colorScheme')}
          aria-label={t('colorScheme')}
          disabled={!loaded}
        >
          <Moon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('colorScheme')}</DropdownMenuLabel>
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={mode === 'helena'}
          onSelect={() => onModeChange('helena')}
        >
          {t('colorSchemeHelena')}
        </DropdownMenuItem>
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={mode === 'light'}
          onSelect={() => onModeChange('light')}
        >
          {t('colorSchemeLight')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
