'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Archive,
  ArchiveRestore,
  Folder,
  FolderMinus,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { uuid } from '@/utils/uuid';
import { useChatFoldersContext } from '../../hooks/useChatFolders';
import { addFolder, folderOfThread, forgetThread, moveToFolder } from '../../utils/chatFolders';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useChatListMutations } from '../../hooks/useChatList';
import ChatRenameDialog from './ChatRenameDialog';

// The row's own actions: pin, rename, archive and delete — restore and purge instead,
// in the trash. Kept out of the row's button so the row stays a single click target.
//
// The menu is not modal and the confirmation closes before the chat is moved: the row
// (and everything it renders) leaves the list the moment the list refetches, and a
// dialog torn down while open can leave the page blocked for clicks. `onRemoved` tells
// the workspace a chat was deleted, so an open one closes instead of lingering.
export default function ChatListItemMenu({
  chat,
  view,
  onRemoved,
}: {
  chat: ChatSummary;
  view: ChatListView;
  onRemoved: (threadId: string) => void;
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
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 opacity-0 group-hover/chat-row:opacity-100 group-has-[[aria-current=true]]/chat-row:opacity-100 hover:bg-transparent focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label={t('list.moreActions')}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {view === 'trash' ? (
            <>
              <DropdownMenuItem onSelect={() => restore.mutate(chat.id)}>
                <ArchiveRestore className="size-4" /> {t('list.restore')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 className="size-4" /> {t('list.deleteForever')}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem
                onSelect={() => pin.mutate({ threadId: chat.id, pinned: !chat.pinned })}
              >
                {chat.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                {t(chat.pinned ? 'list.unpin' : 'list.pin')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Pencil className="size-4" /> {t('list.rename')}
              </DropdownMenuItem>
              {/* The member's own folders (owner, O4). */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Folder className="size-4" /> {t('list.folders.moveTo')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {folders.map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      disabled={folder.id === current?.id}
                      onSelect={() => save(moveToFolder(folders, chat.id, folder.id))}
                    >
                      <Folder className="size-4" /> {folder.name}
                    </DropdownMenuItem>
                  ))}
                  {folders.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={() => setNaming(true)}>
                    <FolderPlus className="size-4" /> {t('list.folders.new')}
                  </DropdownMenuItem>
                  {current && (
                    <DropdownMenuItem onSelect={() => save(moveToFolder(folders, chat.id, null))}>
                      <FolderMinus className="size-4" /> {t('list.folders.takeOut')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem
                onSelect={() =>
                  archive.mutate({ threadId: chat.id, archived: view !== 'archived' })
                }
              >
                {view === 'archived' ? (
                  <ArchiveRestore className="size-4" />
                ) : (
                  <Archive className="size-4" />
                )}
                {t(view === 'archived' ? 'list.unarchive' : 'list.archive')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 className="size-4" /> {t('list.delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
            onRemoved(threadId);
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t('list.deleteConfirmBody', { title: chat.title || t('list.untitled') })}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
