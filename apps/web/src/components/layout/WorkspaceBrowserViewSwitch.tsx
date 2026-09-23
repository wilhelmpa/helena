'use client';

import { useTranslations } from 'next-intl';
import type { BrowserView } from '@/hooks/useBrowserPreferences';
import { Button } from '@/components/ui/button';

// Switches the browser tool between the live view of the tab in front and the whole
// desktop over VNC, which stays available for what the live view does not show.
export default function WorkspaceBrowserViewSwitch({
  view,
  onChange,
}: {
  view: BrowserView;
  onChange: (view: BrowserView) => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const options = [
    { id: 'live', label: t('live'), title: t('liveTitle') },
    { id: 'desktop', label: t('desktop'), title: t('desktopTitle') },
  ] as const;
  return (
    <div role="group" aria-label={t('view')} className="flex shrink-0 items-center">
      {options.map((option) => (
        <Button
          key={option.id}
          variant={view === option.id ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 px-1.5 text-xs"
          aria-pressed={view === option.id}
          title={option.title}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
