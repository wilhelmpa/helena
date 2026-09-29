'use client';

import { useTranslations } from 'next-intl';
import { Bell, MessageSquareText } from 'lucide-react';
import { PageTabs } from '@/components/layout/PageToolbar';

// Home's inbox has the tabs of a project's (owner 29.09., O82): the mail of every account
// and project, and what needs the owner (approvals, mentions, runs to read).
export type OwnerInboxTab = 'messages' | 'updates';

export default function OwnerInboxTabs({
  tab,
  waiting,
  onChange,
}: {
  tab: OwnerInboxTab;
  waiting: number;
  onChange: (tab: OwnerInboxTab) => void;
}) {
  const t = useTranslations('inbox.hub');
  return (
    <PageTabs
      label={t('messages')}
      value={tab}
      onChange={onChange}
      items={[
        { value: 'messages', label: t('messages'), icon: MessageSquareText },
        { value: 'updates', label: t('updates'), icon: Bell, count: waiting || undefined },
      ]}
    />
  );
}
