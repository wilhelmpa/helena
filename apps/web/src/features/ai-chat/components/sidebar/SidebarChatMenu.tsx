'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Archive,
  ArchiveRestore,
  Folder,
  FolderMinus,
  FolderPlus,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Text,
  TreeMoreButton,
} from '@/design-system';
import { uuid } from '@/utils/uuid';
import { useChatFoldersContext } from '../../hooks/useChatFolders';
import { addFolder, folderOfThread, forgetThread, moveToFolder } from '../../utils/chatFolders';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useChatListMutations } from '../../hooks/useChatList';
import ChatRenameDialog from '../workspace/ChatRenameDialog';

// The row's own actions in the sidebar: pin, rename, file in a folder, archive and
// delete — restore and purge instead, in the trash. It is the "…" of the tree row
// (`ds-tree-action`), so the row itself stays a single link.
//
// The menu is not modal and the confirmation closes before the chat is moved: the row
// (and everything it renders) leaves the list the moment the list refetches, and a
// dialog torn down while open can leave the page blocked for clicks. `onRemoved` tells
// the workspace a chat was deleted, so an open one closes instead of lingering.
export default function SidebarChatMenu({
  chat,
  view,
  onRemoved,
}: {
  chat: ChatSummary;
  view: ChatListView;
  onRemoved: (chat: ChatSummary) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const { pin, rename, archive, trash, purge, restore } = useChatListMutations();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [naming, setNaming] = useState(false);
  const { folders, save } = useChatFoldersContext();
  const current = folderOfThread(folders, chat.id);

  return (
    <>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <TreeMoreButton label={t('list.moreActions')} />
        </MenuTrigger>
        <MenuContent align="start">
          {view === 'trash' ? (
            <>
              <MenuItem onSelect={() => restore.mutate(chat.id)}>
                <ArchiveRestore size={16} /> {t('list.restore')}
              </MenuItem>
              <MenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 size={16} /> {t('list.deleteForever')}
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem onSelect={() => pin.mutate({ threadId: chat.id, pinned: !chat.pinned })}>
                {chat.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                {t(chat.pinned ? 'list.unpin' : 'list.pin')}
              </MenuItem>
              <MenuItem onSelect={() => setRenaming(true)}>
                <Pencil size={16} /> {t('list.rename')}
              </MenuItem>
              {/* The member's own folders (owner, O4). */}
              <MenuSub>
                <MenuSubTrigger>
                  <Folder size={16} /> {t('list.folders.moveTo')}
                </MenuSubTrigger>
                <MenuSubContent>
                  {folders.map((folder) => (
                    <MenuItem
                      key={folder.id}
                      disabled={folder.id === current?.id}
                      onSelect={() => save(moveToFolder(folders, chat.id, folder.id))}
                    >
                      <Folder size={16} /> {folder.name}
                    </MenuItem>
                  ))}
                  {folders.length > 0 && <MenuSeparator />}
                  <MenuItem onSelect={() => setNaming(true)}>
                    <FolderPlus size={16} /> {t('list.folders.new')}
                  </MenuItem>
                  {current && (
                    <MenuItem onSelect={() => save(moveToFolder(folders, chat.id, null))}>
                      <FolderMinus size={16} /> {t('list.folders.takeOut')}
                    </MenuItem>
                  )}
                </MenuSubContent>
              </MenuSub>
              <MenuItem
                onSelect={() =>
                  archive.mutate({ threadId: chat.id, archived: view !== 'archived' })
                }
              >
                {view === 'archived' ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                {t(view === 'archived' ? 'list.unarchive' : 'list.archive')}
              </MenuItem>
              <MenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 size={16} /> {t('list.delete')}
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      {renaming && (
        <ChatRenameDialog
          initialTitle={chat.title ?? ''}
          onClose={() => setRenaming(false)}
          onConfirm={(title) => rename.mutateAsync({ threadId: chat.id, title })}
        />
      )}
      {naming && (
        <ChatRenameDialog
          heading={t('list.folders.new')}
          initialTitle=""
          onClose={() => setNaming(false)}
          onConfirm={(name) => save(addFolder(folders, name, uuid(), chat.id))}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('list.deleteConfirmTitle')}
          confirmLabel={t(view === 'trash' ? 'list.deleteForever' : 'list.delete')}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            const threadId = chat.id;
            setDeleting(false);
            await (view === 'trash' ? purge.mutateAsync(threadId) : trash.mutateAsync(threadId));
            if (view === 'trash' && folderOfThread(folders, threadId))
              save(forgetThread(folders, threadId));
            onRemoved(chat);
          }}
        >
          <Text as="p" tone="muted">
            {t('list.deleteConfirmBody', { title: chat.title || t('list.untitled') })}
          </Text>
        </ConfirmDialog>
      )}
    </>
  );
}
