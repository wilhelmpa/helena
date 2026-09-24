'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useHydrated } from '@/components/common/page/useHydrated';
import { useSession } from '@/lib/auth-client';
import { useToday } from '../../hooks/useToday';

// The instance owner (the Administrator), read after hydration so the server render and
// the first client render agree.
export function useIsOwner(): boolean {
  const hydrated = useHydrated();
  const { data: session } = useSession();
  return hydrated && session?.user.role === 'god';
}

// The failures the reader hid. Preview only: kept in memory until the page reloads.
export function useDismissedPreview(): [ReadonlySet<string>, (key: string) => void] {
  const [keys, setKeys] = useState<string[]>([]);
  const dismissed = useMemo(() => new Set(keys), [keys]);
  const dismiss = useCallback((key: string) => setKeys((current) => [...current, key]), []);
  return [dismissed, dismiss];
}

// The page's one title (16px) and today's date (12px).
export function Greeting({ className }: { className?: string }) {
  const t = useTranslations('nav');
  const today = useToday();
  return (
    <div className={className}>
      <h1 className="text-base font-semibold">{t('homeGreeting')}</h1>
      <p className="h-4 text-xs text-muted-foreground">{today}</p>
    </div>
  );
}
