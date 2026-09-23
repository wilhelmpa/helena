'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, ArrowLeft, PanelLeftClose, SquarePen, Trash2 } from 'lucide-react';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import type { ChatListView } from '@/lib/api/endpoints/agentChat';
import { Button } from '@/components/ui/button';
import ChatListSearch from './ChatListSearch';
import ChatListGroups from './ChatListGroups';
import ChatListRowButton from './ChatListRowButton';
import type { ChatListPaneProps } from './ChatListPane';

// The list pane's content, shared by its column and its Sheet drawer rendering: "New
// chat" and the search on top, the chats, and the archive and the trash at the foot —
// each a row in the sidebar's own shape (32px, 16px icon, sidebar-accent on hover).
export default function ChatListPaneBody({
  projectKey,
  mode,
  onOpenChange,
  selectedThreadId,
  onSelectThread,
  onThreadRemoved,
  onNewChat,
}: ChatListPaneProps) {
  const t = useTranslations('chatWorkspace');
  const [view, setView] = useState<ChatListView>('active');
  const { search, setSearch, term } = useSearchTerm();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col text-sidebar-foreground">
      <div className="flex min-w-0 items-center gap-1 p-2 pb-0">
        <ChatListRowButton icon={SquarePen} onClick={onNewChat} className="flex-1">
          {t('list.newChat')}
        </ChatListRowButton>
        {/* In the drawer, its close button; the column beside the conversation has
            nothing to close. */}
        {mode === 'compact' && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 hover:bg-sidebar-accent"
            onClick={() => onOpenChange(false)}
            aria-label={t('list.close')}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>
      <div className="p-2">
        <ChatListSearch value={search} onChange={setSearch} />
      </div>
      {view !== 'active' && (
        <div className="px-2">
          <ChatListRowButton icon={ArrowLeft} onClick={() => setView('active')}>
            {t(view === 'archived' ? 'list.viewArchived' : 'list.viewTrash')}
          </ChatListRowButton>
        </div>
      )}
      <ChatListGroups
        projectKey={projectKey}
        view={view}
        q={term}
        selectedThreadId={selectedThreadId}
        onSelectThread={onSelectThread}
        onThreadRemoved={onThreadRemoved}
      />
      {view === 'active' && (
        <div className="border-t border-sidebar-border p-2">
          <ChatListRowButton icon={Archive} onClick={() => setView('archived')}>
            {t('list.viewArchived')}
          </ChatListRowButton>
          <ChatListRowButton icon={Trash2} onClick={() => setView('trash')}>
            {t('list.viewTrash')}
          </ChatListRowButton>
        </div>
      )}
    </div>
  );
}
