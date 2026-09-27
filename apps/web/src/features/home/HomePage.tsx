'use client';

import Shell from '@/components/layout/Shell';
import { useTranslations } from 'next-intl';
import HomeDashboard from './dashboard/HomeDashboard';

export default function HomePage() {
  const t = useTranslations('nav');
  return (
    <Shell globalHome globalTitle={t('dashboards')} autoOpenGlobalChat={false}>
      <div className="h-full overflow-y-auto pe-(--workspace-overlay-inset)">
        <HomeDashboard />
      </div>
    </Shell>
  );
}
