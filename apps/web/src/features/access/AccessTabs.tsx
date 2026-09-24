'use client';

import { useTranslations } from 'next-intl';
import { Cloud, History, KeyRound, Mail, Plug } from 'lucide-react';
import { PageTabs } from '@/components/layout/PageToolbar';
import { ACCESS_TABS, accessPath, type AccessTab } from '@/utils/paths';

const ICONS = { google: Cloud, mail: Mail, credentials: KeyRound, connections: Plug, log: History };

// The tabs of the access center, first in the header row of every tab.
export function AccessTabs({ value }: { value: AccessTab }) {
  const t = useTranslations('access');
  return (
    <PageTabs
      label={t('title')}
      value={value}
      items={ACCESS_TABS.map((tab) => ({
        value: tab,
        label: t(`tabs.${tab}`),
        icon: ICONS[tab],
        href: accessPath(tab),
      }))}
    />
  );
}
