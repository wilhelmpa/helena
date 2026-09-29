'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, ArrowLeft, MoreHorizontal, PanelLeftClose, SquarePen, Trash2 } from 'lucide-react';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import type { ChatListView } from '@/lib/api/endpoints/agentChat';
import {
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Text,
} from '@/design-system';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useChatListMutations } from '../../hooks/useChatList';
import type { ChatGrouping } from '../../utils/chatGroups';
import ChatListSearch from './ChatListSearch';
import ChatListGroups from './ChatListGroups';
import ChatListRowButton from './ChatListRowButton';
import type { ChatListPaneProps } from './ChatListPane';

const GROUPING_KEY = 'helena:chat-list-grouping';
const GROUPINGS: ChatGrouping[] = ['time', 'project', 'agent'];

function storedGrouping(): ChatGrouping {
  if (typeof window === 'undefined') return 'time';
  try {
    const value = window.localStorage.getItem(GROUPING_KEY);
    return GROUPINGS.find((grouping) => grouping === value) ?? 'time';
  } catch {
    return 'time';
  }
}

// The list pane's content, shared by its column and its drawer: "New chat", the list's
// menu (group by time, project or agent; delete all) and the search on top, the chats,
// and the archive and the trash at the foot.
export default function ChatListPaneBody({
  projectKey,
  agents,
  mode,
  onOpenChange,
  selectedThreadId,
  onSelectThread,
  onThreadRemoved,
  onNewChat,
}: ChatListPaneProps) {
  const t = useTranslations('chatWorkspace');
  const [view, setView] = useState<ChatListView>('active');
  // The list itself only renders once its chats have loaded, so reading the remembered
  // grouping on the first render cannot differ from the server's markup.
  const [grouping, setGrouping] = useState<ChatGrouping>(storedGrouping);
  const [confirming, setConfirming] = useState(false);
  const { search, setSearch, term } = useSearchTerm();
  const { trashAll, emptyTrash } = useChatListMutations();
  const chooseGrouping = (next: ChatGrouping) => {
    setGrouping(next);
    try {
      window.localStorage.setItem(GROUPING_KEY, next);
    } catch {
      // Remembered for this visit only.
    }
  };
  const filter = { projectKey: projectKey ?? undefined };

  return (
    <div className="ds-chat-list">
      <div className="ds-chat-list-head">
        {agents.length > 0 && (
          <ChatListRowButton icon={SquarePen} onClick={onNewChat} className="ds-grow">
            {t('list.newChat')}
          </ChatListRowButton>
        )}
        <Menu modal={false}>
          <MenuTrigger asChild>
            <IconButton label={t('list.options')} size="small">
              <MoreHorizontal size={16} />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>{t('list.groupBy')}</MenuLabel>
            {GROUPINGS.map((option) => (
              <MenuCheckboxItem
                key={option}
                checked={grouping === option}
                onCheckedChange={() => chooseGrouping(option)}
              >
                {t(`list.grouping.${option}`)}
              </MenuCheckboxItem>
            ))}
            <MenuSeparator />
            <MenuItem variant="destructive" onSelect={() => setConfirming(true)}>
              <Trash2 size={16} />
              {view === 'trash' ? t('list.emptyTrash') : t('list.deleteAll')}
            </MenuItem>
          </MenuContent>
        </Menu>
        {/* In the drawer, its close button; the column beside the conversation has
            nothing to close. */}
        {mode === 'compact' && (
          <IconButton label={t('list.close')} size="small" onClick={() => onOpenChange(false)}>
            <PanelLeftClose size={16} />
          </IconButton>
        )}
      </div>
      <ChatListSearch value={search} onChange={setSearch} />
      {view !== 'active' && (
        <ChatListRowButton icon={ArrowLeft} onClick={() => setView('active')}>
          {t(view === 'archived' ? 'list.viewArchived' : 'list.viewTrash')}
        </ChatListRowButton>
      )}
      <ChatListGroups
        projectKey={projectKey}
        view={view}
        q={term}
        grouping={grouping}
        selectedThreadId={selectedThreadId}
        onSelectThread={onSelectThread}
        onThreadRemoved={onThreadRemoved}
      />
      {view === 'active' && (
        <div className="ds-chat-list-foot">
          <ChatListRowButton icon={Archive} onClick={() => setView('archived')}>
            {t('list.viewArchived')}
          </ChatListRowButton>
          <ChatListRowButton icon={Trash2} onClick={() => setView('trash')}>
            {t('list.viewTrash')}
          </ChatListRowButton>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title={view === 'trash' ? t('list.emptyTrashTitle') : t('list.deleteAllTitle')}
          confirmLabel={view === 'trash' ? t('list.emptyTrash') : t('list.deleteAll')}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            if (view === 'trash') await emptyTrash.mutateAsync(filter);
            else await trashAll.mutateAsync({ ...filter, view });
            if (selectedThreadId) onThreadRemoved(selectedThreadId);
          }}
        >
          <Text as="p" tone="muted">
            {view === 'trash' ? t('list.emptyTrashBody') : t('list.deleteAllBody')}
          </Text>
        </ConfirmDialog>
      )}
    </div>
  );
}
