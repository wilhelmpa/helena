'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, MessageSquareText } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { useInboxUnread } from '@/hooks/useInboxUnread';
import { PageTabs } from '@/components/layout/PageToolbar';
import { Segmented } from '@/design-system';
import InboxView from './components/InboxView';
import MailInbox from './components/MailInbox';
import { useProjectMailAccounts } from '@/services/mail.service';
import InboxWorkspace from './InboxWorkspace';

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
  const [all, setAll] = useState(false);
  const unread = useInboxUnread(project?.project.key ?? null, project?.project.id ?? null).data;

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
        { value: 'updates', label: t('updates'), icon: Bell, count: unread || undefined },
      ]}
    />
  );
  // This project or every project: a view of the same inbox, so a segment in the one
  // header row before the tabs (design-system §9), not a row of its own.
  const leading = (
    <>
      <Segmented
        label={t('scope')}
        value={all ? 'all' : 'project'}
        onChange={(next) => setAll(next === 'all')}
        options={[
          { value: 'project', label: t('scopeProject') },
          { value: 'all', label: t('scopeAll') },
        ]}
      />
      {tabs}
    </>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {all ? (
        activeTab === 'messages' ? (
          <InboxWorkspace projectKey={null} page leading={leading} />
        ) : (
          <InboxView project={null} leading={leading} />
        )
      ) : activeTab === 'messages' ? (
        <MailInbox
          teamId={project.project.teamId}
          projectId={project.project.id}
          toolbar
          leading={leading}
        />
      ) : (
        <InboxView key={project.project.key} project={project} leading={leading} />
      )}
    </div>
  );
}
