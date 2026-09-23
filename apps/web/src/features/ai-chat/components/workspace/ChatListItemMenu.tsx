'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useChatListMutations } from '../../hooks/useChatList';
import ChatRenameDialog from './ChatRenameDialog';

// The row's own actions: pin, rename, archive and delete — restore and purge instead,
// in the trash. Kept out of the row's button so the row stays a single click target.
export default function ChatListItemMenu({
  chat,
  view,
}: {
  chat: ChatSummary;
  view: ChatListView;
}) {
  const t = useTranslations('chatWorkspace');
  const { pin, rename, archive, trash, purge, restore } = useChatListMutations();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <DropdownMenu>
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
      {deleting && (
        <ConfirmDialog
          title={t('list.deleteConfirmTitle')}
          confirmLabel={t(view === 'trash' ? 'list.deleteForever' : 'list.delete')}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await (view === 'trash' ? purge.mutateAsync(chat.id) : trash.mutateAsync(chat.id));
            setDeleting(false);
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
