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
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <p className="flex-1 px-4 py-8 text-center text-sm text-muted-foreground">
        {q ? t('list.noMatches') : t(`list.empty.${view}`)}
      </p>
    );
  }

  return (
    <nav aria-label={t('list.title')} className="flex-1 space-y-4 overflow-y-auto p-2 pb-4">
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
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
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div ref={sentinelRef} />
      {query.isFetchingNextPage && <Skeleton className="mx-2 h-12 rounded-md" />}
    </nav>
  );
}
