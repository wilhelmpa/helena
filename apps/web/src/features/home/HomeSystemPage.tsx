'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import SectionPageView from '@/components/common/page/SectionPageView';
import HomeSystemHealth from './components/home/HomeSystemHealth';

export default function HomeSystemPage() {
  const t = useTranslations('nav');
  return (
    <Shell globalHome globalTitle={t('sidebarSystem')} autoOpenGlobalChat={false}>
      <SectionPageView title={t('sidebarSystem')} wide>
        <HomeSystemHealth />
      </SectionPageView>
    </Shell>
  );
}
