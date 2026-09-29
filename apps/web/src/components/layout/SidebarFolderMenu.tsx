'use client';

import { useState } from 'react';
import { FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/design-system';
import type { FileItem, FileScope } from '@/lib/api/endpoints/projectFiles';
import FileMoveDialog from '@/features/project-files/components/FileMoveDialog';
import FileNewFolderDialog from '@/features/project-files/components/FileNewFolderDialog';
import FileRenameDialog from '@/features/project-files/components/FileRenameDialog';
import FileTrashDialog from '@/features/project-files/components/FileTrashDialog';

type Open = 'new' | 'rename' | 'move' | 'trash' | null;

// The "…" of a folder in the Wissen tree (Auftrag 117): a new subfolder, rename, move and
// the trash (which names what the folder holds first). The fixed folders of a project
// (Docs, Files, Assets, Boards, Inbox) only take a subfolder.
export default function SidebarFolderMenu({
  scope,
  path,
  name,
  fixed,
}: {
  scope: FileScope;
  path: string;
  name: string;
  fixed: boolean;
}) {
  const t = useTranslations('files.actions');
  const tNav = useTranslations('nav');
  const [open, setOpen] = useState<Open>(null);
  const item: FileItem = {
    name,
    path,
    kind: 'folder',
    contentType: null,
    sizeBytes: null,
    updatedAt: null,
  };
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className="ds-tree-action"
            aria-label={t('more', { name })}
            title={t('more', { name })}
          >
            <MoreHorizontal />
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem onSelect={() => setOpen('new')}>
            <FolderPlus />
            {tNav('sidebarNewFolder')}
          </MenuItem>
          {!fixed && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => setOpen('rename')}>
                <Pencil />
                {t('rename')}
              </MenuItem>
              <MenuItem onSelect={() => setOpen('move')}>
                <FolderInput />
                {t('move')}
              </MenuItem>
              <MenuItem variant="destructive" onSelect={() => setOpen('trash')}>
                <Trash2 />
                {t('trash')}
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      {open === 'new' && (
        <FileNewFolderDialog scope={scope} folder={path} onClose={() => setOpen(null)} />
      )}
      {open === 'rename' && (
        <FileRenameDialog scope={scope} item={item} onClose={() => setOpen(null)} />
      )}
      {open === 'move' && (
        <FileMoveDialog scope={scope} item={item} onClose={() => setOpen(null)} />
      )}
      {open === 'trash' && (
        <FileTrashDialog scope={scope} item={item} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
