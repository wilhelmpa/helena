'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Archive,
  ArchiveRestore,
  ListPlus,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useChatListMutations } from '../../hooks/useChatList';
import { useSaveChatNote } from '../../hooks/useSaveChatNote';
import type { PlanUIMessage } from '../../utils/chatMessages';

// The open chat's own actions: rename, pin, turn it into a task, keep it as a note,
// archive, delete. Deleting hands the view back to the workspace (`onDeleted`) instead
// of navigating, so it works the same in the tool panel, which owns no address.
export default function ChatHeaderMenu({
  scopeKey,
  threadId,
  chat,
  messages,
  agentName,
  onRename,
  onToIssue,
  onDeleted,
}: {
  scopeKey: string;
  threadId: string;
  chat: ChatSummary | undefined;
  messages: PlanUIMessage[];
  agentName: string;
  onRename: () => void;
  // Absent outside a project, where there is no backlog to add a task to.
  onToIssue?: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('chatWorkspace');
  const { pin, archive, trash } = useChatListMutations();
  const saveNote = useSaveChatNote();
  const [deleting, setDeleting] = useState(false);

  if (!chat) return null;

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={t('list.moreActions')}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil className="size-4" /> {t('list.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pin.mutate({ threadId, pinned: !chat.pinned })}>
            {chat.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {t(chat.pinned ? 'list.unpin' : 'list.pin')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              await saveNote.mutateAsync({
                scopeKey,
                title: chat.title || t('list.untitled'),
                agentName: () => agentName,
                messages,
              });
              toast.success(t('messages.noteSaved'));
            }}
          >
            <NotebookPen className="size-4" /> {t('messages.saveAsNote')}
          </DropdownMenuItem>
          {onToIssue && (
            <DropdownMenuItem onSelect={onToIssue}>
              <ListPlus className="size-4" /> {t('issue.fromChat')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => archive.mutate({ threadId, archived: chat.archivedAt == null })}
          >
            {chat.archivedAt != null ? (
              <ArchiveRestore className="size-4" />
            ) : (
              <Archive className="size-4" />
            )}
            {t(chat.archivedAt != null ? 'list.unarchive' : 'list.archive')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 className="size-4" /> {t('list.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {deleting && (
        <ConfirmDialog
          title={t('list.deleteConfirmTitle')}
          confirmLabel={t('list.delete')}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            // Closed first: leaving the chat unmounts this menu, and a dialog torn down
            // while open can leave the page blocked for clicks.
            setDeleting(false);
            await trash.mutateAsync(threadId);
            onDeleted();
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
