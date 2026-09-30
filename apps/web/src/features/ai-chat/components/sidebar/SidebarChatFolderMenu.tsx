'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderX, Pencil } from 'lucide-react';
import { Menu, MenuContent, MenuItem, MenuTrigger, TreeMoreButton } from '@/design-system';
import { useChatFoldersContext } from '../../hooks/useChatFolders';
import { removeFolder, renameFolder } from '../../utils/chatFolders';
import ChatRenameDialog from '../workspace/ChatRenameDialog';

// A folder's own actions in the sidebar (O4): rename it, or dissolve it — its chats go
// back to their agents' sections, none is deleted.
export default function SidebarChatFolderMenu({
  folderId,
  name,
}: {
  folderId: string;
  name: string;
}) {
  const t = useTranslations('chatWorkspace');
  const { folders, save } = useChatFoldersContext();
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <TreeMoreButton label={t('list.folders.actions', { name })} />
        </MenuTrigger>
        <MenuContent align="start">
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
