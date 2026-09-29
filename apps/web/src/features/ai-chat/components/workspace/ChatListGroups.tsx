'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Folder, MessagesSquare } from 'lucide-react';
import { useDisplayName } from '@/context/displayName';
import type { ChatListView } from '@/lib/api/endpoints/agentChat';
import { EmptyState } from '@/design-system';
import { Skeleton } from '@/components/ui/skeleton';
import { chatsOf, useChatList } from '../../hooks/useChatList';
import {
  groupChats,
  groupChatsBy,
  type ChatGroup,
  type ChatGrouping,
} from '../../utils/chatGroups';
import ChatListItem from './ChatListItem';
import ChatFolderMenu from './ChatFolderMenu';
import { useChatFoldersContext } from '../../hooks/useChatFolders';
import { withFolders } from '../../utils/chatFolders';

export interface ChatListGroupsProps {
  projectKey: string | null;
  view: ChatListView;
  q?: string;
  grouping?: ChatGrouping;
  selectedThreadId: string | null;
  onSelectThread: (thread: { id: string; agentId: number }) => void;
  onThreadRemoved: (threadId: string) => void;
}

function groupLabel(t: ReturnType<typeof useTranslations>, group: ChatGroup): string {
  if (group.label) return group.label;
  const key = group.key;
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
  grouping = 'time',
  selectedThreadId,
  onSelectThread,
  onThreadRemoved,
}: ChatListGroupsProps) {
  const t = useTranslations('chatWorkspace');
  const appName = useDisplayName();
  const query = useChatList({ projectKey: projectKey ?? undefined, q, view });
  const chats = chatsOf(query.data);
  const { folders } = useChatFoldersContext();
  // The member's own folders stand over the automatic groups of the active list (O4).
  const shownFolders = useMemo(() => (q || view !== 'active' ? [] : folders), [q, view, folders]);
  // A search ranks by relevance (title, then the member's words, then the agent's), so
  // it stays one list; grouping it would scatter the best matches.
  const groups = useMemo<ChatGroup[]>(
    () =>
      q
        ? [{ key: 'today', chats, label: t('list.searchResults') }]
        : withFolders(
            grouping === 'time'
              ? groupChats(chats, new Date())
              : groupChatsBy(chats, grouping, appName),
            chats,
            shownFolders,
          ),
    [chats, q, grouping, t, shownFolders, appName],
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
      <div className="ds-chat-list-body">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="ds-chat-list-skeleton" />
        ))}
      </div>
    );
  }

  if (chats.length === 0 && shownFolders.length === 0) {
    return (
      <div className="ds-chat-list-body">
        <EmptyState icon={<MessagesSquare />} fill={false}>
          {q ? t('list.noMatches') : t(`list.empty.${view}`)}
        </EmptyState>
      </div>
    );
  }

  return (
    <nav aria-label={t('list.title')} className="ds-chat-list-body">
      {groups.map((group) => (
        <section key={group.key} className="ds-chat-list-group">
          {group.folderId ? (
            <div className="ds-chat-list-group-label" data-folder>
              <Folder size={14} aria-hidden="true" />
              <h3>{group.label}</h3>
              <ChatFolderMenu folderId={group.folderId} name={group.label ?? ''} />
            </div>
          ) : (
            <h3 className="ds-chat-list-group-label">{groupLabel(t, group)}</h3>
          )}
          {group.folderId && group.chats.length === 0 && (
            <p className="ds-chat-list-folder-empty">{t('list.folders.empty')}</p>
          )}
          <ul>
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
        </section>
      ))}
      <div ref={sentinelRef} />
      {query.isFetchingNextPage && <Skeleton className="ds-chat-list-skeleton" />}
    </nav>
  );
}
