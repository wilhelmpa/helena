'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, MessageSquareText } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { useInboxUnread } from '@/hooks/useInboxUnread';
import { PageTabs } from '@/components/layout/PageToolbar';
import InboxView from './components/InboxView';
import MailInbox from './components/MailInbox';
import { useProjectMailAccounts } from '@/services/mail.service';
import { Page } from '@/design-system';
import { Text } from '@/design-system';

type InboxTab = 'messages' | 'updates';

// The per-project inbox (/project/:projectKey/inbox): only this project's mail and
// notifications (owner 29.09., O82; the mail of every project is Home's inbox). One
// header row (PageToolbar): the two tabs first, then the open tab's own controls — each
// tab renders the row with the tabs as its `leading` part, so the row always belongs to
// what is on screen.
export default function InboxPage() {
  const t = useTranslations('inbox.hub');
  const { project } = useShell();
  const [tab, setTab] = useState<InboxTab>('messages');
  const mailAccounts = useProjectMailAccounts(project?.project.key);
  const unread = useInboxUnread(project?.project.key ?? null, project?.project.id ?? null).data;

  if (!project) return null;
  if (mailAccounts.isPending)
    return (
      <Text as="p" size="sm" tone="muted" className="p-8">
        {t('mailLoading')}
      </Text>
    );
  if (mailAccounts.isError)
    return (
      <Text as="p" size="sm" tone="muted" className="p-8">
        {t('mailError')}
      </Text>
    );
  const hasMail = (mailAccounts.data?.length ?? 0) > 0;
  const activeTab = hasMail ? tab : 'updates';
  // Without a mailbox there is only one tab, and one tab is no choice: no tab row then.
  const tabs = hasMail ? (
    <PageTabs
      label={t('messages')}
      value={activeTab}
      onChange={setTab}
      items={[
        ...(hasMail
          ? [{ value: 'messages' as const, label: t('messages'), icon: MessageSquareText }]
          : []),
        { value: 'updates', label: t('updates'), icon: Bell, count: unread || undefined },
      ]}
    />
  ) : null;
  // Edge to edge (owner 29.09., O74): the list and the reading pane run to the sides of
  // the page; only the header row above them keeps the page's margin.
  return (
    <Page variant="split">
      {activeTab === 'messages' ? (
        <MailInbox
          teamId={project.project.teamId}
          projectId={project.project.id}
          toolbar
          leading={tabs}
        />
      ) : (
        <InboxView key={project.project.key} project={project} leading={tabs} />
      )}
    </Page>
  );
}
