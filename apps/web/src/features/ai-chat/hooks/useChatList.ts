'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  deleteChat,
  emptyChatTrash,
  listChats,
  trashAllChats,
  restoreChat,
  setChatPinned,
  updateChat,
  type ChatListView,
  type ChatSummary,
} from '@/lib/api/endpoints/agentChat';
import { nextPageParam } from '@/lib/api/core/paging';
import { qk } from '@/services/queryKeys';

export const CHAT_LIST_PAGE_SIZE = 30;

export interface ChatListFilter {
  projectKey?: string;
  agentId?: number;
  q?: string;
  view?: ChatListView;
}

// The caller's chats for the workspace's list pane, loaded a page at a time as the
// reader scrolls. A search term is its own query, so the unfiltered list stays
// cached while one is typed (see the old history rail's agentThreads for the same
// reasoning).
export function useChatList(filter: ChatListFilter) {
  return useInfiniteQuery({
    queryKey: qk.chatList(filter),
    queryFn: ({ pageParam }) =>
      listChats({ page: pageParam, pageSize: CHAT_LIST_PAGE_SIZE }, filter),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });
}

export function chatsOf(data: { pages: { items: ChatSummary[] }[] } | undefined): ChatSummary[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

// Every mutation on a chat of the list invalidates every loaded list: pinning,
// renaming, archiving and deleting each move a chat between sections or off the list
// entirely, which a single cache patch would have to reimplement for every filter a
// pane might be showing.
export function useChatListMutations() {
  const client = useQueryClient();
  const t = useTranslations('chatWorkspace');
  // The list and the chat's own record (title, pin — read by the header) are separate
  // cache entries; every mutation here changes both.
  const invalidate = (threadId?: string) =>
    Promise.all([
      client.invalidateQueries({ queryKey: qk.anyChatList }),
      threadId ? client.invalidateQueries({ queryKey: qk.chat(threadId) }) : Promise.resolve(),
    ]);

  const pin = useMutation({
    mutationFn: ({ threadId, pinned }: { threadId: string; pinned: boolean }) =>
      setChatPinned(threadId, pinned),
    onSuccess: (_data, { threadId }) => invalidate(threadId),
  });

  const rename = useMutation({
    mutationFn: ({ threadId, title }: { threadId: string; title: string }) =>
      updateChat(threadId, { title }),
    onSuccess: (_data, { threadId }) => {
      toast.success(t('list.renamed'));
      return invalidate(threadId);
    },
  });

  const archive = useMutation({
    mutationFn: ({ threadId, archived }: { threadId: string; archived: boolean }) =>
      updateChat(threadId, { archived }),
    onSuccess: (_data, { threadId, archived }) => {
      toast.success(t(archived ? 'list.archived' : 'list.unarchived'));
      return invalidate(threadId);
    },
  });

  const trash = useMutation({
    mutationFn: (threadId: string) => deleteChat(threadId),
    onSuccess: (_data, threadId) => {
      toast.success(t('list.trashed'));
      return invalidate(threadId);
    },
  });

  const purge = useMutation({
    mutationFn: (threadId: string) => deleteChat(threadId, true),
    onSuccess: () => {
      toast.success(t('list.purged'));
      return invalidate();
    },
  });

  const restore = useMutation({
    mutationFn: (threadId: string) => restoreChat(threadId),
    onSuccess: (_data, threadId) => {
      toast.success(t('list.restored'));
      return invalidate(threadId);
    },
  });

  const trashAll = useMutation({
    mutationFn: (filter: { projectKey?: string; view: 'active' | 'archived' }) =>
      trashAllChats(filter),
    onSuccess: ({ count }) => {
      toast.success(t('list.trashedAll', { count }));
      return client.invalidateQueries({ queryKey: qk.anyChatList });
    },
  });

  const emptyTrash = useMutation({
    mutationFn: (filter: { projectKey?: string }) => emptyChatTrash(filter),
    onSuccess: ({ count }) => {
      toast.success(t('list.purgedAll', { count }));
      return client.invalidateQueries({ queryKey: qk.anyChatList });
    },
  });

  return { pin, rename, archive, trash, purge, restore, trashAll, emptyTrash };
}
