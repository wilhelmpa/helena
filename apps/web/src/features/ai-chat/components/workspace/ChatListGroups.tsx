'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatListView } from '@/lib/api/endpoints/agentChat';
import { Skeleton } from '@/components/ui/skeleton';
import { chatsOf, useChatList } from '../../hooks/useChatList';
import { groupChats, type ChatGroup } from '../../utils/chatGroups';
import ChatListItem from './ChatListItem';

export interface ChatListGroupsProps {
  projectKey: string | null;
  view: ChatListView;
  q?: string;
  selectedThreadId: string | null;
  onSelectThread: (thread: { id: string; agentId: number }) => void;
  onThreadRemoved: (threadId: string) => void;
}

function groupLabel(t: ReturnType<typeof useTranslations>, key: ChatGroup['key']): string {
  switch (key) {
    case 'pinned':
      return t('list.group.pinned');
    case 'today':
      return t('list.group.today');
    case 'yesterday':
      return t('list.group.yesterday');
    case 'week':
      return t('list.group.week');
    case 'month':
      return t('list.group.month');
    default:
      return new Date(`${key.slice(2)}-01T00:00:00Z`).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
  }
}

// The chats, grouped and lazily paged as the reader scrolls to the bottom. A search
// (q) reads every matching chat with its ranked snippet instead of the plain, grouped
// list — the groups mean "when", which a search hit does not.
export default function ChatListGroups({
  projectKey,
  view,
  q,
  selectedThreadId,
  onSelectThread,
  onThreadRemoved,
}: ChatListGroupsProps) {
  const t = useTranslations('chatWorkspace');
  const query = useChatList({ projectKey: projectKey ?? undefined, q, view });
  const chats = chatsOf(query.data);
  // A search ranks by relevance (title, then the member's words, then the agent's), so
  // it stays one list; grouping by "when" would scatter the best matches across dates.
  const groups = useMemo<ChatGroup[]>(
    () => (q ? [{ key: 'today', chats }] : groupChats(chats, new Date())),
    [chats, q],
  );
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        query.fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [query]);

  if (query.isLoading) {
    return (
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <p className="min-h-0 flex-1 px-4 py-6 text-center text-sm text-muted-foreground">
        {q ? t('list.noMatches') : t(`list.empty.${view}`)}
      </p>
    );
  }

  // Styled after the sidebar's groups: a 32px label in 12px medium at 70%, rows packed
  // 2px apart.
  return (
    <nav
      aria-label={t('list.title')}
      className="min-h-0 flex-1 scrollbar-thin space-y-2 overflow-y-auto px-2 pb-2"
    >
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="flex h-8 items-center px-2 text-xs font-medium text-sidebar-foreground/70">
            {q ? t('list.searchResults') : groupLabel(t, group.key)}
          </h3>
          <ul className="space-y-0.5">
            {group.chats.map((chat) => (
              <li key={chat.id}>
                <ChatListItem
                  chat={chat}
                  view={view}
                  selected={chat.id === selectedThreadId}
                  onSelect={() => onSelectThread({ id: chat.id, agentId: chat.agent.id })}
                  highlightQuery={q}
                  onRemoved={onThreadRemoved}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div ref={sentinelRef} />
      {query.isFetchingNextPage && <Skeleton className="h-8 rounded-md" />}
    </nav>
  );
}
