'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import SectionPageView from '@/components/common/page/SectionPageView';
import BrowserLab from './components/BrowserLab';

// Browser 2.0 inside a project (/project/KEY/browser-lab): the project's browser, its agents
// and its decision model connections.
export default function BrowserLabPage() {
  const { projectKey } = useParams<{ projectKey: string }>();
  const t = useTranslations('browserLab');
  return (
    <SectionPageView title={t('title')} description={null} wide>
      <BrowserLab key={projectKey} scope={{ kind: 'project', projectKey }} />
    </SectionPageView>
  );
}
