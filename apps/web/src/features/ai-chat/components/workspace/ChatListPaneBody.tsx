'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PanelLeftClose, Plus } from 'lucide-react';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import type { ChatListView } from '@/lib/api/endpoints/agentChat';
import { Button } from '@/components/ui/button';
import { SheetClose } from '@/components/ui/sheet';
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
  selectedThreadId,
  onSelectThread,
  onNewChat,
}: ChatListPaneProps) {
  const t = useTranslations('chatWorkspace');
  const [view, setView] = useState<ChatListView>('active');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const { search, setSearch, term } = useSearchTerm();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2 p-3 pb-2">
        <ChatListSearch value={search} onChange={setSearch} className="min-w-0 flex-1" />
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          onClick={() => setNewChatOpen(true)}
          aria-label={t('list.newChat')}
        >
          <Plus className="size-4" />
        </Button>
        {/* The Sheet's own close trigger (see ChatListPane, which hides the default
            one at the sheet's own corner): the only close button, in the row's own
            flow instead of floating over it. Absent in the split column, which is
            never inside a Sheet to begin with. */}
        {mode === 'compact' && (
          <SheetClose asChild>
            <Button size="icon" variant="ghost" className="shrink-0" aria-label={t('list.close')}>
              <PanelLeftClose className="size-4" />
            </Button>
          </SheetClose>
        )}
      </div>
      <div className="min-w-0 px-3 pb-2">
        <Tabs value={view} onValueChange={(value) => setView(value as ChatListView)}>
          <TabsList className="w-full">
            <TabsTrigger value="active" className="min-w-0 flex-1">
              {t('list.viewActive')}
            </TabsTrigger>
            <TabsTrigger value="archived" className="min-w-0 flex-1">
              {t('list.viewArchived')}
            </TabsTrigger>
            <TabsTrigger value="trash" className="min-w-0 flex-1">
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
