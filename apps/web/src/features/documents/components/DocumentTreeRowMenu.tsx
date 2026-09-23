'use client';

import {
  FilePlus2,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  PencilLine,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { VaultTreeItem } from '@/lib/api/endpoints/knowledge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DocumentTreeAction } from './DocumentTreeDialog';

export default function DocumentTreeRowMenu({
  item,
  onNewNote,
  onAction,
}: {
  item: VaultTreeItem;
  onNewNote: (folder: string) => void;
  onAction: (action: DocumentTreeAction) => void;
}) {
  const t = useTranslations('documents');
  const run = (kind: DocumentTreeAction['kind']) => () => onAction({ kind, path: item.path });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
          aria-label={t('itemActions', { name: item.title })}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {item.kind === 'folder' && (
          <>
            <DropdownMenuItem onSelect={() => onNewNote(item.path)}>
              <FilePlus2 />
              {t('newNote')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run('newFolder')}>
              <FolderPlus />
              {t('newFolder')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={run('rename')}>
          <PencilLine />
          {t('rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={run('move')}>
          <FolderInput />
          {t('moveToFolder')}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={run('trash')}>
          <Trash2 />
          {t('moveToTrash')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
