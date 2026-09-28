'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, MessageSquareText } from 'lucide-react';
import { useShell } from '@/context/shellContext';
import { useInboxUnread } from '@/hooks/useInboxUnread';
import { PageTabs } from '@/components/layout/PageToolbar';
import InboxView from './components/InboxView';
import MailInbox from './components/MailInbox';
import InboxWorkspace from './InboxWorkspace';
import AllProjectsUpdates from './AllProjectsUpdates';
import { useProjectsQuery } from '@/services/projects.service';

type InboxTab = 'messages' | 'updates';

// The per-project inbox (/project/:projectKey/inbox): the mail filed under the project,
// and the session user's notifications for it. One header row (PageToolbar): the two
// tabs first, then the open tab's own controls — each tab renders the row with the
// tabs as its `leading` part, so the row always belongs to what is on screen.
export default function InboxPage() {
  const t = useTranslations('inbox.hub');
  const { project } = useShell();
  const [tab, setTab] = useState<InboxTab>('messages');
  const [all, setAll] = useState(false);
  const projects = useProjectsQuery().data ?? [];
  const unread = useInboxUnread(project?.project.key ?? null, project?.project.id ?? null).data;

  if (!project) return null;
  const tabs = (
    <PageTabs
      label={t('messages')}
      value={tab}
      onChange={setTab}
      items={[
        { value: 'messages', label: t('messages'), icon: MessageSquareText },
        { value: 'updates', label: t('updates'), icon: Bell, count: unread || undefined },
      ]}
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex gap-1 border-b border-border p-2"
        role="group"
        aria-label="Inbox-Projekte"
      >
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm ${!all ? 'bg-accent' : ''}`}
          aria-pressed={!all}
          onClick={() => setAll(false)}
        >
          {t('scopeProject')}
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm ${all ? 'bg-accent' : ''}`}
          aria-pressed={all}
          onClick={() => setAll(true)}
        >
          {t('scopeAll')}
        </button>
      </div>
      {all && <div className="border-b border-border p-2">{tabs}</div>}
      {all ? (
        tab === 'messages' ? (
          <InboxWorkspace projectKey={null} />
        ) : (
          <AllProjectsUpdates projects={projects} />
        )
      ) : tab === 'messages' ? (
        <MailInbox
          teamId={project.project.teamId}
          projectId={project.project.id}
          toolbar
          leading={tabs}
        />
      ) : (
        <InboxView key={project.project.key} project={project} leading={tabs} />
      )}
    </div>
  );
}
