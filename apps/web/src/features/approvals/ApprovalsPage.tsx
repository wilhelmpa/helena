'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import SectionPageView from '@/components/common/page/SectionPageView';
import ApprovalsView from './components/ApprovalsView';

// Every decision waiting for the reader across the projects they may decide in: the
// requests agents made before acting outside Helena, and the workflow runs waiting at an
// approval. The decided tab keeps the agents' requests with their outcome. The project
// filter narrows both tabs to one project; its options are only the projects the reader
// may already decide in (see GET /approvals/projects).
export default function ApprovalsPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('approvals');
  return (
    <Shell globalHome globalTitle={tNav('approvals')} autoOpenGlobalChat={false}>
      <SectionPageView title={tNav('approvals')} description={t('hint')} wide>
        <ApprovalsView />
      </SectionPageView>
    </Shell>
  );
}
