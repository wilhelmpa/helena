'use client';

import { useState } from 'react';
import { Bell, MessageSquareText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { PageTabs } from '@/components/layout/PageToolbar';
import InboxView from './components/InboxView';
import InboxWorkspace from './InboxWorkspace';

export default function GlobalInboxPage() {
  const t = useTranslations('nav');
  const hub = useTranslations('inbox.hub');
  const [tab, setTab] = useState<'updates' | 'messages'>('updates');
  const tabs = (
    <PageTabs
      label={t('inbox')}
      value={tab}
      onChange={setTab}
      items={[
        { value: 'updates', label: hub('updates'), icon: Bell },
        { value: 'messages', label: hub('messages'), icon: MessageSquareText },
      ]}
    />
  );
  return (
    <Shell globalHome globalTitle={t('inbox')} autoOpenGlobalChat={false}>
      {tab === 'updates' ? (
        <InboxView project={null} leading={tabs} />
      ) : (
        <InboxWorkspace projectKey={null} page />
      )}
    </Shell>
  );
}
