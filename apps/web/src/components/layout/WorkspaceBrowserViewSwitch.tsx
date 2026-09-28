'use client';

import { useTranslations } from 'next-intl';
import type { BrowserView } from '@/hooks/useBrowserPreferences';
import { Segmented } from '@/design-system';

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
    <Segmented
      label={t('view')}
      value={view}
      onChange={onChange}
      options={options.map((option) => ({
        value: option.id,
        label: option.label,
        title: option.title,
      }))}
    />
  );
}
