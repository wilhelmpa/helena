'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import InboxWorkspace from './InboxWorkspace';
import AllProjectsUpdates from './AllProjectsUpdates';
import { useProjectsQuery } from '@/services/projects.service';

export default function GlobalInboxPage() {
  const t = useTranslations('nav');
  const inbox = useTranslations('inbox.hub');
  const [updates, setUpdates] = useState(false);
  const projects = useProjectsQuery().data ?? [];
  return (
    <Shell globalHome globalTitle={t('inbox')} autoOpenGlobalChat={false}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex gap-1 border-b border-border p-2" role="group" aria-label="Inbox-Art">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${!updates ? 'bg-accent' : ''}`}
            aria-pressed={!updates}
            onClick={() => setUpdates(false)}
          >
            {inbox('messages')}
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${updates ? 'bg-accent' : ''}`}
            aria-pressed={updates}
            onClick={() => setUpdates(true)}
          >
            {inbox('updates')}
          </button>
        </div>
        {updates ? (
          <AllProjectsUpdates projects={projects} />
        ) : (
          <InboxWorkspace projectKey={null} page />
        )}
      </div>
    </Shell>
  );
}
