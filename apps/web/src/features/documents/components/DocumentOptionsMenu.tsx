'use client';

import { Download, EllipsisVertical, FolderInput, History, NotebookPen, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { vaultFileUrl, type VaultDocument } from '@/lib/api/endpoints/knowledge';
import { cn } from '@/lib/utils';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { notesFileUrl } from '@/utils/vaultLinks';
import { PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { baseName } from '../utils/vaultPaths';
import type { DocumentEditorDialog } from './DocumentEditorDialogs';

export default function DocumentOptionsMenu({
  document,
  canEdit,
  onOpenDialog,
}: {
  document: VaultDocument;
  canEdit: boolean;
  onOpenDialog: (dialog: DocumentEditorDialog) => void;
}) {
  const t = useTranslations('documents');
  // The note in the notes (a new tab on their own origin), where this origin has them.
  const notes = notesFileUrl(runtimeEnv().workspace.notesUrl, document.path);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('noteActions')}
          title={t('noteActions')}
          className={cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0')}
        >
          <EllipsisVertical aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {notes && (
          <DropdownMenuItem asChild>
            <a href={notes} target="_blank" rel="noopener noreferrer">
              <NotebookPen />
              {t('openInNotes')}
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href={vaultFileUrl(document.path)} download={baseName(document.path)}>
            <Download />
            {t('download')}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOpenDialog('history')}>
          <History />
          {t('versionHistory')}
        </DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onOpenDialog('move')}>
              <FolderInput />
              {t('moveToFolder')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onOpenDialog('trash')}>
              <Trash2 />
              {t('moveToTrash')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
