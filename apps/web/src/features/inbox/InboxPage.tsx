'use client';

import { useShell } from '@/context/shellContext';
import InboxView from './components/InboxView';
import MailInbox from './components/MailInbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslations } from 'next-intl';
import { Bell, MessageSquareText } from 'lucide-react';
import { WORKSPACE_HEADER_CLASS } from '@/components/layout/WorkspaceHeader';

// The per-project inbox (/project/:projectKey/inbox): the mail filed under the project,
// and the session user's notifications for it.
export default function InboxPage() {
  const t = useTranslations('inbox.hub');
  const { project } = useShell();
  if (!project) return null;
  return (
    <Tabs defaultValue="messages" className="h-full min-h-0 gap-0">
      <TabsList
        variant="toolbar"
        className={`${WORKSPACE_HEADER_CLASS} w-full justify-start gap-1 px-3`}
      >
        <TabsTrigger value="messages">
          <MessageSquareText />
          {t('messages')}
        </TabsTrigger>
        <TabsTrigger value="updates">
          <Bell />
          {t('updates')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="messages" className="min-h-0 flex-1">
        <MailInbox teamId={project.project.teamId} projectId={project.project.id} />
      </TabsContent>
      <TabsContent value="updates" className="min-h-0 flex-1">
        <InboxView key={project.project.key} project={project} />
      </TabsContent>
    </Tabs>
  );
}
