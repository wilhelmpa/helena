'use client';

import { Download, ExternalLink, FolderInput, History, MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { vaultFileUrl, type VaultDocument } from '@/lib/api/endpoints/knowledge';
import { Button } from '@/components/ui/button';
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('noteActions')}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <a href={document.obsidianUrl}>
            <ExternalLink />
            {t('openInObsidian')}
          </a>
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
