'use client';

import { createElement, useState, type DragEvent } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { TreeAction, TreeItem } from '@/design-system';
import { toast } from 'sonner';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { useFilesQuery } from '@/services/files.service';
import {
  useMoveFile,
  useUploadFiles,
} from '@/features/project-files/services/projectFiles.service';
import { ENTRY_TYPE, isEntryDrag, moveTarget } from '@/features/project-files/utils/fileDrag';
import FileNewFolderDialog from '@/features/project-files/components/FileNewFolderDialog';
import { filesPath, homeFilesPath } from '@/utils/paths';
import {
  compareKnowledgeFolders,
  folderIcon,
  isDirectChildFolder,
  knowledgeFolderLabel,
} from '@/utils/knowledgeFolders';

function folderUrl(scope: FileScope, path: string) {
  return scope.kind === 'project'
    ? filesPath(scope.projectKey, path)
    : homeFilesPath(path, { root: scope.root });
}

function FolderNode({
  scope,
  path,
  name,
  depth,
  canWrite,
}: {
  scope: FileScope;
  path: string;
  name: string;
  depth: number;
  canWrite: boolean;
}) {
  const fixed = useTranslations('files.fixedFolders');
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const params = useSearchParams();
  const scopeMatches = scope.kind === 'project' || (params.get('root') ?? 'home') === scope.root;
  const onFilesPage =
    pathname === (scope.kind === 'project' ? filesPath(scope.projectKey) : '/files');
  const current = onFilesPage && params.get('path') === path && scopeMatches;
  const isAncestor =
    onFilesPage && scopeMatches && (params.get('path') ?? '').startsWith(`${path}/`);
  const [over, setOver] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const listing = useFilesQuery(scope, path);
  const move = useMoveFile(scope);
  const upload = useUploadFiles(scope);
  const children = (
    listing.data?.items.filter((item) => isDirectChildFolder(item, path)) ?? []
  ).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const drop = (event: DragEvent<HTMLElement>) => {
    if (!canWrite) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    if (isEntryDrag(event)) {
      const from = event.dataTransfer.getData(ENTRY_TYPE);
      const to = moveTarget(from, path);
      if (to)
        move.mutate({ from, to }, { onError: () => toast.error('Verschieben fehlgeschlagen') });
    } else if (event.dataTransfer.files.length) {
      upload.mutate(
        { folder: path, files: Array.from(event.dataTransfer.files) },
        { onError: () => toast.error('Hochladen fehlgeschlagen') },
      );
    }
  };
  const scopeKey = scope.kind === 'project' ? scope.projectKey : `home:${scope.root}`;
  return (
    <>
      <TreeItem
        label={scope.kind === 'project' && depth === 0 ? knowledgeFolderLabel(name, fixed) : name}
        href={folderUrl(scope, path)}
        icon={createElement(folderIcon(path, scope.kind === 'project'))}
        active={current}
        containsActive={isAncestor}
        storageKey={`folder:${scopeKey}:${path}`}
        defaultOpen={false}
        className={over ? 'is-drop-target' : undefined}
        rowProps={{
          onDragOver: (event) => {
            if (!canWrite) return;
            event.preventDefault();
            event.stopPropagation();
            setOver(true);
          },
          onDragLeave: () => setOver(false),
          onDrop: drop,
        }}
        actions={
          canWrite && (
            <TreeAction label={tNav('sidebarNewFolder')} onClick={() => setNewFolder(true)}>
              <Plus />
            </TreeAction>
          )
        }
      >
        {children.length > 0
          ? children.map((child) => (
              <FolderNode
                key={child.path}
                scope={scope}
                path={child.path}
                name={child.name}
                depth={depth + 1}
                canWrite={canWrite}
              />
            ))
          : null}
      </TreeItem>
      {newFolder && (
        <FileNewFolderDialog scope={scope} folder={path} onClose={() => setNewFolder(false)} />
      )}
    </>
  );
}

// The folders of a knowledge root as rows of the sidebar tree (fixed folders first in
// their order, own folders alphabetically). A folder is a drop target for files and
// entries; its "+" adds a subfolder.
export default function SidebarKnowledgeFolders({
  scope,
  canWrite = false,
  depth = 0,
}: {
  scope: FileScope;
  canWrite?: boolean;
  // Indent of the first level (Home nests the folders under Home, Privat, Vorlagen).
  depth?: number;
}) {
  const listing = useFilesQuery(scope, '');
  const folders =
    listing.data?.items
      .filter((item) => isDirectChildFolder(item, ''))
      .sort((a, b) =>
        scope.kind === 'project'
          ? compareKnowledgeFolders(a.name, b.name)
          : a.name.localeCompare(b.name, 'de'),
      ) ?? [];
  return (
    <>
      {folders.map((folder) => (
        <FolderNode
          key={folder.path}
          scope={scope}
          path={folder.path}
          name={folder.name}
          depth={depth}
          canWrite={canWrite}
        />
      ))}
    </>
  );
}
