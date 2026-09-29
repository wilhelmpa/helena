'use client';

import { Download, EllipsisVertical, FolderInput, History, Code2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { vaultFileUrl, type VaultDocument } from '@/lib/api/endpoints/knowledge';
import { cn } from '@/lib/utils';
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
  onOpenSource,
  onOpenDialog,
}: {
  document: VaultDocument;
  canEdit: boolean;
  onOpenSource: () => void;
  onOpenDialog: (dialog: DocumentEditorDialog) => void;
}) {
  const t = useTranslations('documents');
  const tFiles = useTranslations('files.unified');

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
        <DropdownMenuItem onSelect={onOpenSource}>
          <Code2 />
          {tFiles('source')}
        </DropdownMenuItem>
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
