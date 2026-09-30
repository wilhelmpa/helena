'use client';

import { useContext, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Archive, Folder, MessagesSquare, Pin, Trash2 } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import { useDisplayName } from '@/context/displayName';
import { ShellCtx } from '@/context/shellContext';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';
import { Skeleton } from '@/components/ui/skeleton';
import { TreeItem, TreeNote, TreeScroll, TreeSearch } from '@/design-system';
import { chatPath } from '@/utils/paths';
import { chatsOf, useChatList } from '../../hooks/useChatList';
import { ChatFoldersContext, useChatFolders } from '../../hooks/useChatFolders';
import { useChatSummary } from '../../hooks/useChatSummary';
import { useChatWorkspaceScope } from '../../hooks/useChatWorkspaceScope';
import { agentDisplayName } from '../../utils/agentChip';
import { chatHref } from '../../utils/chatHref';
import { agentOrderByRole, chatSections } from '../../utils/chatSections';
import { useOrganizationQuery } from '@/features/organization/services/organization.service';
import { withOpenChat } from '../../utils/chatListWithOpen';
import SidebarChatRow from './SidebarChatRow';
import SidebarChatFolderMenu from './SidebarChatFolderMenu';
import SidebarChatNew, { SidebarChatNewInAgent } from './SidebarChatNew';
import { SidebarChatsMenu, SidebarChatTrashMenu } from './SidebarChatsMenu';

// Reads the next page when the end of the list scrolls into view.
function useLoadMore(query: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return ref;
}

function Loading() {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="ds-tree-skeleton" />
      ))}
    </>
  );
}

// The archive and the trash: their chats as rows, read only once the group is opened.
function SidebarChatsOfView({
  view,
  projectKey,
  onRemoved,
}: {
  view: Exclude<ChatListView, 'active'>;
  projectKey: string | null;
  onRemoved: (chat: ChatSummary) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const query = useChatList({ projectKey: projectKey ?? undefined, view });
  const more = useLoadMore(query);
  const chats = chatsOf(query.data);
  if (query.isLoading) return <Loading />;
  return (
    <>
      {chats.length === 0 && <TreeNote>{t(`list.empty.${view}`)}</TreeNote>}
      {chats.map((chat) => (
        <SidebarChatRow
          key={chat.id}
          chat={chat}
          view={view}
          projectKey={projectKey}
          active={false}
          onRemoved={onRemoved}
        />
      ))}
      <div ref={more} />
    </>
  );
}

// The chat list in the sidebar (owner, O87), a level-1 area of the tree like the others:
// the pinned chats, the member's own folders and one section per agent — the home agent,
// the coordinator, the specialists — each with a "+" for a new chat with it; a search;
// the archive and the trash at the foot. The chat page beside it shows only the
// conversation. `active` says the tree marks this area (the chat page is open).
export default function SidebarChats({
  projectKey,
  active,
}: {
  projectKey: string | null;
  active: boolean;
}) {
  const t = useTranslations('chatWorkspace');
  const tNav = useTranslations('nav');
  const appName = useDisplayName();
  const router = useRouter();
  const params = useSearchParams();
  const shell = useContext(ShellCtx);
  const scope = useChatWorkspaceScope(projectKey);
  const chatFolders = useChatFolders();
  const { search, setSearch, term } = useSearchTerm();
  const query = useChatList({ projectKey: projectKey ?? undefined, q: term, view: 'active' });
  const more = useLoadMore(query);

  // The open chat: it stays in the list even where the list's own scope does not hold it.
  const activeThreadId = active ? params.get('thread') : null;
  const openChat = useChatSummary(activeThreadId).data ?? null;
  const loaded = chatsOf(query.data);
  const chats = useMemo(
    () => withOpenChat(loaded, openChat, 'active', !!term),
    [loaded, openChat, term],
  );
  const markedInList = activeThreadId != null && chats.some((chat) => chat.id === activeThreadId);

  const agents = scope.agents;
  const organization = useOrganizationQuery(scope.teamId);
  const agentOrder = useMemo(() => {
    const roles = new Map((organization.data?.agents ?? []).map((agent) => [agent.id, agent.role]));
    return agentOrderByRole(agents, (id) => roles.get(id));
  }, [agents, organization.data]);
  const sections = useMemo(
    () => chatSections(chats, term ? [] : chatFolders.folders, agentOrder),
    [chats, term, chatFolders.folders, agentOrder],
  );
  const agentName = (id: number, fallback: string) => {
    const agent = agents.find((entry) => entry.id === id);
    return agent ? agentDisplayName(agent, appName) : fallback;
  };

  // A deleted chat never stays open: the page moves to a new chat with the same agent.
  const removed = (chat: ChatSummary) => {
    if (chat.id !== params.get('thread')) return;
    router.replace(chatHref(projectKey, { agentId: chat.agent.id }), { scroll: false });
  };
  // "Delete all": the open chat closes too, unless it is still being answered (it stays).
  const cleared = () => {
    const thread = params.get('thread');
    const open = chats.find((chat) => chat.id === thread);
    if (!open || open.running) return;
    removed(open);
  };
  // The chat tool is open beside another page: a chat opens there, not instead of the page.
  const inPanel = shell?.chatPanelOpen && !active;
  const openInPanel = inPanel
    ? (chat: ChatSummary) => shell?.onOpenChatThread(chat.agent.id, chat.id)
    : undefined;
  const row = (chat: ChatSummary) => (
    <SidebarChatRow
      key={chat.id}
      chat={chat}
      view="active"
      projectKey={projectKey}
      active={active && chat.id === activeThreadId}
      onRemoved={removed}
      onOpenInPanel={openInPanel}
    />
  );
  const holdsActive = (list: ChatSummary[]) => list.some((chat) => chat.id === activeThreadId);
  const storage = (name: string) => `chats:${projectKey ?? 'home'}:${name}`;
  const empty = !query.isLoading && chats.length === 0 && sections.folders.length === 0;

  return (
    <ChatFoldersContext.Provider value={chatFolders}>
      <TreeItem
        id="chats"
        label={tNav('sidebarChats')}
        icon={<MessagesSquare />}
        href={projectKey ? chatPath(projectKey) : undefined}
        active={active && !markedInList}
        actions={
          <>
            <SidebarChatNew projectKey={projectKey} agents={agents} />
            <SidebarChatsMenu projectKey={projectKey} onCleared={cleared} />
          </>
        }
      >
        <TreeSearch value={search} onChange={setSearch} label={t('list.search')} />
        <TreeScroll label={tNav('sidebarChats')}>
          {query.isLoading && <Loading />}
          {empty && <TreeNote>{term ? t('list.noMatches') : t('list.empty.active')}</TreeNote>}
          {term ? (
            chats.map(row)
          ) : (
            <>
              {sections.pinned.length > 0 && (
                <TreeItem
                  label={t('list.group.pinned')}
                  mark={<Pin size={14} aria-hidden="true" />}
                  storageKey={storage('pinned')}
                  containsActive={holdsActive(sections.pinned)}
                >
                  {sections.pinned.map(row)}
                </TreeItem>
              )}
              {sections.folders.map(({ folder, chats: filed }) => (
                <TreeItem
                  key={folder.id}
                  label={folder.name}
                  mark={<Folder size={14} aria-hidden="true" />}
                  storageKey={storage(`folder:${folder.id}`)}
                  containsActive={holdsActive(filed)}
                  actions={<SidebarChatFolderMenu folderId={folder.id} name={folder.name} />}
                >
                  {filed.length > 0 ? (
                    filed.map(row)
                  ) : (
                    <TreeNote>{t('list.folders.empty')}</TreeNote>
                  )}
                </TreeItem>
              ))}
              {sections.agents.map(({ agent, chats: own }) => (
                <TreeItem
                  key={agent.id}
                  label={agentName(agent.id, agent.name)}
                  mark={<Avatar name={agent.name} className="size-4" aria-hidden />}
                  storageKey={storage(`agent:${agent.id}`)}
                  containsActive={holdsActive(own)}
                  actions={
                    <SidebarChatNewInAgent
                      projectKey={projectKey}
                      agentId={agent.id}
                      name={agentName(agent.id, agent.name)}
                    />
                  }
                >
                  {own.map(row)}
                </TreeItem>
              ))}
              <div ref={more} />
              {query.isFetchingNextPage && <Loading />}
              <TreeItem
                label={t('list.viewArchived')}
                mark={<Archive size={14} aria-hidden="true" />}
                storageKey={storage('archived')}
                defaultOpen={false}
              >
                <SidebarChatsOfView view="archived" projectKey={projectKey} onRemoved={removed} />
              </TreeItem>
              <TreeItem
                label={t('list.viewTrash')}
                mark={<Trash2 size={14} aria-hidden="true" />}
                storageKey={storage('trash')}
                defaultOpen={false}
                actions={<SidebarChatTrashMenu projectKey={projectKey} />}
              >
                <SidebarChatsOfView view="trash" projectKey={projectKey} onRemoved={removed} />
              </TreeItem>
            </>
          )}
        </TreeScroll>
      </TreeItem>
    </ChatFoldersContext.Provider>
  );
}
