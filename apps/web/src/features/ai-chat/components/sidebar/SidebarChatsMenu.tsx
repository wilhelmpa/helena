'use client';

import { useState } from 'react';
import { Archive, FolderPlus, MessagesSquare, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Text,
  TreeAction,
  TreeMoreButton,
} from '@/design-system';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import type { ChatListView } from '@/lib/api/endpoints/agentChat';
import { uuid } from '@/utils/uuid';
import { chatsOf, useChatList, useChatListMutations } from '../../hooks/useChatList';
import { useChatFoldersContext } from '../../hooks/useChatFolders';
import { addFolder } from '../../utils/chatFolders';
import ChatRenameDialog from '../workspace/ChatRenameDialog';

// "Empty the trash" (owner, O101): the dialog names how many chats go for good. With an empty
// trash it says so and offers nothing to confirm. Read from the trash list the sidebar
// shows, so the number is the one in front of the reader.
export function EmptyTrashDialog({
  projectKey,
  onClose,
}: {
  projectKey: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('chatWorkspace');
  const { emptyTrash } = useChatListMutations();
  const query = useChatList({ projectKey: projectKey ?? undefined, view: 'trash' });
  const count = query.data?.pages[0]?.total ?? chatsOf(query.data).length;
  return (
    <ConfirmDialog
      title={query.isLoading ? t('list.emptyTrash') : t('list.emptyTrashCount', { count })}
      confirmLabel={t('list.deleteForever')}
      confirmDisabled={query.isLoading || count === 0}
      onClose={onClose}
      onConfirm={async () => {
        await emptyTrash.mutateAsync({ projectKey: projectKey ?? undefined });
        onClose();
      }}
    >
      {count > 0 && (
        <Text as="p" tone="muted">
          {t('list.emptyTrashBody')}
        </Text>
      )}
    </ConfirmDialog>
  );
}

// The button on the trash's own heading: emptying it stands where the trash is shown.
export function SidebarChatTrashEmpty({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('chatWorkspace');
  const [open, setOpen] = useState(false);
  return (
    <>
      <TreeAction label={t('list.emptyTrash')} onClick={() => setOpen(true)}>
        <Trash2 />
      </TreeAction>
      {open && <EmptyTrashDialog projectKey={projectKey} onClose={() => setOpen(false)} />}
    </>
  );
}

// The "…" of the chat area (owner, O100): the archive and the trash are views of this one
// list, not rows of their own — the menu switches between them. Beside that: a new folder of
// the member's own (O4), every chat of the list into the trash (a chat still being answered
// stays), and emptying the trash for good.
export function SidebarChatsMenu({
  projectKey,
  view,
  onView,
  onCleared,
}: {
  projectKey: string | null;
  view: ChatListView;
  onView: (view: ChatListView) => void;
  // Every chat of the list was moved to the trash: an open one has to close.
  onCleared: () => void;
}) {
  const t = useTranslations('chatWorkspace');
  const { folders, save } = useChatFoldersContext();
  const { trashAll } = useChatListMutations();
  const [namingFolder, setNamingFolder] = useState(false);
  const [confirming, setConfirming] = useState<'clear' | 'empty' | null>(null);
  return (
    <>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <TreeMoreButton label={t('list.options')} />
        </MenuTrigger>
        <MenuContent align="start">
          {view !== 'active' && (
            <MenuItem onSelect={() => onView('active')}>
              <MessagesSquare size={16} />
              {t('list.showChats')}
            </MenuItem>
          )}
          {view === 'active' && (
            <MenuItem onSelect={() => setNamingFolder(true)}>
              <FolderPlus size={16} />
              {t('list.folders.new')}
            </MenuItem>
          )}
          {view !== 'archived' && (
            <MenuItem onSelect={() => onView('archived')}>
              <Archive size={16} />
              {t('list.showArchived')}
            </MenuItem>
          )}
          {view !== 'trash' && (
            <MenuItem onSelect={() => onView('trash')}>
              <Trash2 size={16} />
              {t('list.showTrash')}
            </MenuItem>
          )}
          <MenuSeparator />
          {view === 'active' && (
            <MenuItem variant="destructive" onSelect={() => setConfirming('clear')}>
              <Trash2 size={16} />
              {t('list.deleteAll')}
            </MenuItem>
          )}
          <MenuItem variant="destructive" onSelect={() => setConfirming('empty')}>
            <Trash2 size={16} />
            {t('list.emptyTrash')}
          </MenuItem>
        </MenuContent>
      </Menu>
      {namingFolder && (
        <ChatRenameDialog
          heading={t('list.folders.new')}
          initialTitle=""
          onClose={() => setNamingFolder(false)}
          onConfirm={(name) => save(addFolder(folders, name, uuid()))}
        />
      )}
      {confirming === 'clear' && (
        <ConfirmDialog
          title={t('list.deleteAllTitle')}
          confirmLabel={t('list.deleteAll')}
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            setConfirming(null);
            await trashAll.mutateAsync({ projectKey: projectKey ?? undefined, view: 'active' });
            onCleared();
          }}
        >
          <Text as="p" tone="muted">
            {t('list.deleteAllBody')}
          </Text>
        </ConfirmDialog>
      )}
      {confirming === 'empty' && (
        <EmptyTrashDialog projectKey={projectKey} onClose={() => setConfirming(null)} />
      )}
    </>
  );
}
