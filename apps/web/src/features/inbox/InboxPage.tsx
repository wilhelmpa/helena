'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, MessageSquareText } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { PageTabs } from '@/components/layout/PageToolbar';
import InboxView from './components/InboxView';
import MailInbox from './components/MailInbox';
import { useProjectMailAccounts } from '@/services/mail.service';

type InboxTab = 'messages' | 'updates';

// The per-project inbox (/project/:projectKey/inbox): the mail filed under the project,
// and the session user's notifications for it. One header row (PageToolbar): the two
// tabs first, then the open tab's own controls — each tab renders the row with the
// tabs as its `leading` part, so the row always belongs to what is on screen.
export default function InboxPage() {
  const t = useTranslations('inbox.hub');
  const { project } = useShell();
  const [tab, setTab] = useState<InboxTab>('messages');
  const mailAccounts = useProjectMailAccounts(project?.project.key);

  if (!project) return null;
  if (mailAccounts.isPending)
    return <p className="p-8 text-sm text-muted-foreground">{t('mailLoading')}</p>;
  if (mailAccounts.isError)
    return <p className="p-8 text-sm text-muted-foreground">{t('mailError')}</p>;
  const hasMail = (mailAccounts.data?.length ?? 0) > 0;
  const activeTab = hasMail ? tab : 'updates';
  const tabs = (
    <PageTabs
      label={t('messages')}
      value={activeTab}
      onChange={setTab}
      items={[
        ...(hasMail
          ? [{ value: 'messages' as const, label: t('messages'), icon: MessageSquareText }]
          : []),
        { value: 'updates', label: t('updates'), icon: Bell },
      ]}
    />
  );
  return activeTab === 'messages' ? (
    <MailInbox
      teamId={project.project.teamId}
      projectId={project.project.id}
      toolbar
      leading={tabs}
    />
  ) : (
    <InboxView key={project.project.key} project={project} leading={tabs} />
  );
}
