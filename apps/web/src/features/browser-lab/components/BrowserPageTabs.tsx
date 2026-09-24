'use client';

import { FlaskConical, LayoutGrid } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageTabs } from '@/components/layout/PageToolbar';
import { browserOverviewPath } from '@/utils/paths';
import { browserLabPath } from '../utils/paths';

export type BrowserPageTab = 'overview' | 'lab';

// Home → Browser: the overview of every project browser, and Browser 2.0 next to it.
export function BrowserPageTabs({ value }: { value: BrowserPageTab }) {
  const t = useTranslations('browserLab.tabs');
  return (
    <PageTabs<BrowserPageTab>
      label={t('label')}
      value={value}
      items={[
        { value: 'overview', label: t('overview'), icon: LayoutGrid, href: browserOverviewPath() },
        { value: 'lab', label: t('lab'), icon: FlaskConical, href: browserLabPath(null) },
      ]}
    />
  );
}
