'use client';

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Folder, MessagesSquare, Pin, Search } from 'lucide-react';
import Avatar from '@/components/common/Avatar';
import { useDisplayName } from '@/context/displayName';
import { ShellCtx } from '@/context/shellContext';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';
import { Skeleton } from '@/components/ui/skeleton';
import { TreeAction, TreeItem, TreeNote, TreeScroll, TreeSearch } from '@/design-system';
import { chatPath } from '@/utils/paths';
import { chatsOf, useChatList } from '../../hooks/useChatList';
import { ChatFoldersContext, useChatFolders } from '../../hooks/useChatFolders';
import { useChatSummary } from '../../hooks/useChatSummary';
import { useChatWorkspaceScope } from '../../hooks/useChatWorkspaceScope';
import { agentDisplayName } from '../../utils/agentChip';
import { chatHref } from '../../utils/chatHref';
import {
  agentOrderByRole,
  chatSections,
  foldedChats,
  mixesProjects,
} from '../../utils/chatSections';
import { useOrganizationQuery } from '@/features/organization/services/organization.service';
import { withOpenChat } from '../../utils/chatListWithOpen';
import SidebarChatRow from './SidebarChatRow';
import SidebarChatFolderMenu from './SidebarChatFolderMenu';
import SidebarChatNew, { SidebarChatNewInAgent } from './SidebarChatNew';
import { SidebarChatsMenu, SidebarChatTrashEmpty } from './SidebarChatsMenu';

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

// The archive and the trash: their chats as rows, read only once the view is opened.
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
          showProject={projectKey == null}
          onRemoved={onRemoved}
        />
      ))}
      <div ref={more} />
    </>
  );
}

// More than this many chats of one agent are folded into a "further n" row.
const SHOWN = 5;

// The chat list in the sidebar (owner, O87, made quieter in O100), a level-1 area of the
// tree like the others: the pinned chats, the member's own folders and one group per agent
// — the home agent, the coordinator, the specialists — each with its number of chats.
// Search is a field that opens on request; the archive and the trash are views the "…" of
// the area switches to, not rows of their own. The chat page beside it shows only the
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
  const [searching, setSearching] = useState(false);
  const [view, setView] = useState<ChatListView>('active');
  const [expanded, setExpanded] = useState<string[]>([]);
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
  const mixes = (list: ChatSummary[]) => mixesProjects(list, projectKey != null);
  const row = (chat: ChatSummary, showProject: boolean, mark?: ReactNode) => (
    <SidebarChatRow
      key={chat.id}
      chat={chat}
      view="active"
      projectKey={projectKey}
      active={active && chat.id === activeThreadId}
      showProject={showProject}
      mark={mark}
      onRemoved={removed}
      onOpenInPanel={openInPanel}
    />
  );
  const holdsActive = (list: ChatSummary[]) => list.some((chat) => chat.id === activeThreadId);
  const storage = (name: string) => `chats:${projectKey ?? 'home'}:${name}`;
  const empty = !query.isLoading && chats.length === 0 && sections.folders.length === 0;
  const closeSearch = () => {
    setSearching(false);
    setSearch('');
  };
  const changeView = (next: ChatListView) => {
    setView(next);
    closeSearch();
  };

  // The rows of a group: all but the first few fold into a "further n" row.
  const rows = (id: string, list: ChatSummary[], showProject: boolean) => {
    const { shown, hidden } = foldedChats(list, SHOWN, expanded.includes(id), holdsActive);
    return (
      <>
        {shown.map((chat) => row(chat, showProject))}
        {hidden > 0 && (
          <TreeItem
            label={t('list.more', { count: hidden })}
            onSelect={() => setExpanded((current) => [...current, id])}
          />
        )}
      </>
    );
  };
  const group = (
    id: string,
    label: string,
    list: ChatSummary[],
    extra: { mark?: ReactNode; actions?: ReactNode; open?: boolean } = {},
  ) => (
    <TreeItem
      key={id}
      label={label}
      mark={extra.mark}
      count={list.length}
      actions={extra.actions}
      storageKey={storage(id)}
      defaultOpen={extra.open ?? false}
      containsActive={holdsActive(list)}
    >
      {rows(id, list, mixes(list))}
    </TreeItem>
  );

  // Every group is folded, except the pinned chats — or, without any, the first agent — and
  // the one holding the open chat: the list is an overview first.
  const groupList = (
    <>
      {sections.pinned.length > 0 &&
        group('pinned', t('list.group.pinned'), sections.pinned, {
          mark: <Pin size={16} aria-hidden="true" />,
          open: true,
        })}
      {sections.folders.map(({ folder, chats: filed }) =>
        group(`folder:${folder.id}`, folder.name, filed, {
          mark: <Folder size={16} aria-hidden="true" />,
          actions: <SidebarChatFolderMenu folderId={folder.id} name={folder.name} />,
        }),
      )}
      {sections.agents.map(({ agent, chats: own }, index) =>
        group(`agent:${agent.id}`, agentName(agent.id, agent.name), own, {
          mark: <Avatar name={agent.name} className="size-4" aria-hidden />,
          open: index === 0 && sections.pinned.length === 0,
          actions: (
            <SidebarChatNewInAgent
              projectKey={projectKey}
              agentId={agent.id}
              name={agentName(agent.id, agent.name)}
              hoverOnly
            />
          ),
        }),
      )}
    </>
  );

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
            {view === 'active' && (
              <TreeAction
                label={t('list.search')}
                onClick={() => (searching ? closeSearch() : setSearching(true))}
              >
                <Search />
              </TreeAction>
            )}
            <SidebarChatNew projectKey={projectKey} agents={agents} />
            <SidebarChatsMenu
              projectKey={projectKey}
              view={view}
              onView={changeView}
              onCleared={cleared}
            />
          </>
        }
      >
        {searching && view === 'active' && (
          <TreeSearch
            value={search}
            onChange={setSearch}
            label={t('list.search')}
            focusOnOpen
            onEscape={closeSearch}
          />
        )}
        <TreeScroll label={tNav('sidebarChats')}>
          {view !== 'active' && (
            // The archive or the trash: one group headed by a way back, its chats below it.
            <TreeItem
              label={t(view === 'archived' ? 'list.viewArchived' : 'list.viewTrash')}
              mark={<ArrowLeft size={16} aria-hidden="true" />}
              title={t('list.showChats')}
              onSelect={() => changeView('active')}
              actions={
                view === 'trash' ? <SidebarChatTrashEmpty projectKey={projectKey} /> : undefined
              }
              fixed
            >
              <SidebarChatsOfView view={view} projectKey={projectKey} onRemoved={removed} />
            </TreeItem>
          )}
          {view === 'active' && (
            <>
              {query.isLoading && <Loading />}
              {empty && <TreeNote>{term ? t('list.noMatches') : t('list.empty.active')}</TreeNote>}
              {term ? chats.map((chat) => row(chat, mixes(chats))) : groupList}
              <div ref={more} />
              {query.isFetchingNextPage && <Loading />}
            </>
          )}
        </TreeScroll>
      </TreeItem>
    </ChatFoldersContext.Provider>
  );
}
