'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderX, MoreHorizontal, Pencil } from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuItem, MenuTrigger } from '@/design-system';
import { useChatFoldersContext } from '../../hooks/useChatFolders';
import { removeFolder, renameFolder } from '../../utils/chatFolders';
import ChatRenameDialog from './ChatRenameDialog';

// A folder's own actions in the chat list (O4): rename it, or dissolve it — its chats go
// back to the automatic groups, none is deleted.
export default function ChatFolderMenu({ folderId, name }: { folderId: string; name: string }) {
  const t = useTranslations('chatWorkspace');
  const { folders, save } = useChatFoldersContext();
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <IconButton label={t('list.folders.actions', { name })} size="small">
            <MoreHorizontal size={14} />
          </IconButton>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={() => setRenaming(true)}>
            <Pencil size={16} />
            {t('list.folders.rename')}
          </MenuItem>
          <MenuItem onSelect={() => save(removeFolder(folders, folderId))}>
            <FolderX size={16} />
            {t('list.folders.dissolve')}
          </MenuItem>
        </MenuContent>
      </Menu>
      {renaming && (
        <ChatRenameDialog
          heading={t('list.folders.rename')}
          initialTitle={name}
          onClose={() => setRenaming(false)}
          onConfirm={(next) => save(renameFolder(folders, folderId, next))}
        />
      )}
    </>
  );
}
