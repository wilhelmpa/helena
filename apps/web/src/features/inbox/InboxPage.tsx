'use client';

import { useShell } from '@/context/shellContext';
import InboxView from './components/InboxView';
import HubInboxView from './components/HubInboxView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslations } from 'next-intl';
import { Bell, MessageSquareText } from 'lucide-react';
import { WORKSPACE_HEADER_CLASS } from '@/components/layout/WorkspaceHeader';

// The per-project inbox (/project/:projectKey/inbox): a list of the session user's
// notifications for this project on the left, the selected issue on the right. On a
// narrow screen only one of the two is on screen at a time.
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
        <HubInboxView key={project.project.teamId} teamId={project.project.teamId} />
      </TabsContent>
      <TabsContent value="updates" className="min-h-0 flex-1">
        <InboxView key={project.project.key} project={project} />
      </TabsContent>
    </Tabs>
  );
}
