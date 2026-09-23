'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PanelLeftClose, Plus } from 'lucide-react';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import type { ChatListView } from '@/lib/api/endpoints/agentChat';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ChatListSearch from './ChatListSearch';
import ChatListGroups from './ChatListGroups';
import NewChatAgentPicker from './NewChatAgentPicker';
import type { ChatListPaneProps } from './ChatListPane';

// The list pane's content, shared by its column and its Sheet drawer rendering.
export default function ChatListPaneBody({
  projectKey,
  agents,
  mode,
  onOpenChange,
  selectedThreadId,
  onSelectThread,
  onNewChat,
}: ChatListPaneProps) {
  const t = useTranslations('chatWorkspace');
  const [view, setView] = useState<ChatListView>('active');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const { search, setSearch, term } = useSearchTerm();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 p-3 pb-2">
        <ChatListSearch value={search} onChange={setSearch} className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setNewChatOpen(true)}
          aria-label={t('list.newChat')}
        >
          <Plus className="size-4" />
        </Button>
        {mode === 'compact' && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label={t('list.close')}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>
      <div className="px-3 pb-2">
        <Tabs value={view} onValueChange={(value) => setView(value as ChatListView)}>
          <TabsList className="w-full">
            <TabsTrigger value="active" className="flex-1">
              {t('list.viewActive')}
            </TabsTrigger>
            <TabsTrigger value="archived" className="flex-1">
              {t('list.viewArchived')}
            </TabsTrigger>
            <TabsTrigger value="trash" className="flex-1">
              {t('list.viewTrash')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <ChatListGroups
        projectKey={projectKey}
        view={view}
        q={term}
        selectedThreadId={selectedThreadId}
        onSelectThread={onSelectThread}
      />
      <NewChatAgentPicker
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        agents={agents}
        onPick={(agentId) => {
          setNewChatOpen(false);
          onNewChat(agentId);
        }}
      />
    </div>
  );
}
