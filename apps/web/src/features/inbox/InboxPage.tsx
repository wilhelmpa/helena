'use client';

import { useState } from 'react';
import { useShell } from '@/context/shellContext';
import { useShellHeaderExtra } from '@/hooks/useShellHeaderExtra';
import InboxView from './components/InboxView';
import MailInbox from './components/MailInbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslations } from 'next-intl';
import { Bell, MessageSquareText } from 'lucide-react';
import { WORKSPACE_HEADER_CLASS } from '@/components/layout/WorkspaceHeader';

type InboxTab = 'messages' | 'updates';

// The per-project inbox (/project/:projectKey/inbox): the mail filed under the project,
// and the session user's notifications for it. The tab switcher merges into the
// Shell's single-row header (useShellHeaderExtra) in 'single' layout, the same as
// the board's view tabs; in 'classic' layout it stays its own row.
//
// The switcher and the content it drives end up in two different places in the
// tree once it moves into the header (siblings of Shell's AppHeader, not a
// descendant of it) — too far apart for one <Tabs> root's own state to reach both
// halves. So the active tab is lifted into plain state here and both halves are
// *controlled* <Tabs> instances pointed at it: clicking a trigger in either one
// calls the same onValueChange, which re-renders both.
export default function InboxPage() {
  const t = useTranslations('inbox.hub');
  const { project, headerLayout } = useShell();
  const [tab, setTab] = useState<InboxTab>('messages');

  const triggers = (
    <>
      <TabsTrigger value="messages">
        <MessageSquareText />
        {t('messages')}
      </TabsTrigger>
      <TabsTrigger value="updates">
        <Bell />
        {t('updates')}
      </TabsTrigger>
    </>
  );

  useShellHeaderExtra(
    headerLayout === 'single' ? (
      <Tabs value={tab} onValueChange={(v) => setTab(v as InboxTab)}>
        <TabsList variant="toolbar" className="gap-1">
          {triggers}
        </TabsList>
      </Tabs>
    ) : null,
  );

  if (!project) return null;
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as InboxTab)}
      className="h-full min-h-0 gap-0"
    >
      {headerLayout !== 'single' && (
        <TabsList
          variant="toolbar"
          className={`${WORKSPACE_HEADER_CLASS} w-full justify-start gap-1 px-3`}
        >
          {triggers}
        </TabsList>
      )}
      <TabsContent value="messages" className="min-h-0 flex-1">
        <MailInbox teamId={project.project.teamId} projectId={project.project.id} />
      </TabsContent>
      <TabsContent value="updates" className="min-h-0 flex-1">
        <InboxView key={project.project.key} project={project} />
      </TabsContent>
    </Tabs>
  );
}
