'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import InboxWorkspace from './InboxWorkspace';

export default function GlobalInboxPage() {
  const t = useTranslations('nav');
  return (
    <Shell globalHome globalTitle={t('inbox')} autoOpenGlobalChat={false}>
      <InboxWorkspace projectKey={null} />
    </Shell>
  );
}
