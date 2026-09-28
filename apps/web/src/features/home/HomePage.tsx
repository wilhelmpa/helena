'use client';

import Shell from '@/components/layout/Shell';
import { useTranslations } from 'next-intl';
import HomeDashboard from './dashboard/HomeDashboard';
import { Page } from '@/design-system';

export default function HomePage() {
  const t = useTranslations('nav');
  return (
    <Shell globalHome globalTitle={t('sidebarAllProjects')} autoOpenGlobalChat={false}>
      <Page title={t('sidebarAllProjects')}>
        <HomeDashboard />
      </Page>
    </Shell>
  );
}
