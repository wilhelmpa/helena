'use client';

import { useState } from 'react';
import { FolderPlus, MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Text } from '@/design-system';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { uuid } from '@/utils/uuid';
import { useChatListMutations } from '../../hooks/useChatList';
import { useChatFoldersContext } from '../../hooks/useChatFolders';
import { addFolder } from '../../utils/chatFolders';
import ChatRenameDialog from '../workspace/ChatRenameDialog';

function MoreButton({ label }: { label: string }) {
  return (
    <button type="button" className="ds-tree-action" aria-label={label} title={label}>
      <MoreHorizontal />
    </button>
  );
}

// The "…" of the chat area: a new folder of the member's own (O4), and every chat of the
// list into the trash (a chat still being answered stays).
export function SidebarChatsMenu({
  projectKey,
  onCleared,
}: {
  projectKey: string | null;
  // Every chat of the list was moved to the trash: an open one has to close.
  onCleared: () => void;
}) {
  const t = useTranslations('chatWorkspace');
  const { folders, save } = useChatFoldersContext();
  const { trashAll } = useChatListMutations();
  const [namingFolder, setNamingFolder] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <MoreButton label={t('list.options')} />
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem onSelect={() => setNamingFolder(true)}>
            <FolderPlus size={16} />
            {t('list.folders.new')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2 size={16} />
            {t('list.deleteAll')}
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
      {confirming && (
        <ConfirmDialog
          title={t('list.deleteAllTitle')}
          confirmLabel={t('list.deleteAll')}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await trashAll.mutateAsync({ projectKey: projectKey ?? undefined, view: 'active' });
            onCleared();
          }}
        >
          <Text as="p" tone="muted">
            {t('list.deleteAllBody')}
          </Text>
        </ConfirmDialog>
      )}
    </>
  );
}

// The "…" of the trash: empty it for good.
export function SidebarChatTrashMenu({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('chatWorkspace');
  const { emptyTrash } = useChatListMutations();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <MoreButton label={t('list.options')} />
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2 size={16} />
            {t('list.emptyTrash')}
          </MenuItem>
        </MenuContent>
      </Menu>
      {confirming && (
        <ConfirmDialog
          title={t('list.emptyTrashTitle')}
          confirmLabel={t('list.emptyTrash')}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await emptyTrash.mutateAsync({ projectKey: projectKey ?? undefined });
          }}
        >
          <Text as="p" tone="muted">
            {t('list.emptyTrashBody')}
          </Text>
        </ConfirmDialog>
      )}
    </>
  );
}
