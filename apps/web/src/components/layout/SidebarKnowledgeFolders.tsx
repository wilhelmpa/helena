'use client';

import { useState, type DragEvent } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronRight, Folder, Plus } from 'lucide-react';
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
  const pathname = usePathname();
  const params = useSearchParams();
  const scopeMatches = scope.kind === 'project' || (params.get('root') ?? 'home') === scope.root;
  const current =
    pathname === (scope.kind === 'project' ? filesPath(scope.projectKey) : '/files') &&
    params.get('path') === path &&
    scopeMatches;
  const isAncestor = scopeMatches && (params.get('path') ?? '').startsWith(`${path}/`);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [over, setOver] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const listing = useFilesQuery(scope, path);
  const move = useMoveFile(scope);
  const upload = useUploadFiles(scope);
  const children = listing.data?.items.filter((item) => isDirectChildFolder(item, path)) ?? [];
  const open = expanded ?? isAncestor;
  const drop = (event: DragEvent<HTMLDivElement>) => {
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
        {
          onError: () => toast.error('Hochladen fehlgeschlagen'),
        },
      );
    }
  };
  return (
    <div>
      <div
        className={`helena-tree-parent group relative ${over ? 'bg-[#26212d]' : ''}`}
        style={{ paddingInlineStart: depth * 16 }}
        onDragOver={(event) => {
          if (!canWrite) return;
          event.preventDefault();
          event.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        {children.length > 0 && (
          <button
            type="button"
            className="helena-tree-toggle knowledge-folder-toggle"
            style={{ insetInlineStart: depth * 16 }}
            aria-label={`${open ? 'Schließen' : 'Öffnen'}: ${name}`}
            aria-expanded={open}
            onClick={() => setExpanded(!open)}
          >
            <ChevronRight size={13} className={open ? 'rotate-90' : ''} />
          </button>
        )}
        <Link
          href={folderUrl(scope, path)}
          className={`helena-tree-link helena-tree-child ${current ? 'is-active' : ''}`}
          aria-current={current ? 'page' : undefined}
        >
          <Folder size={14} className="me-2 inline shrink-0 text-muted-foreground" />
          <span className="truncate">
            {scope.kind === 'project' && depth === 0 ? knowledgeFolderLabel(name, fixed) : name}
          </span>
        </Link>
        {canWrite && (
          <button
            type="button"
            className="helena-tree-toggle knowledge-folder-add"
            aria-label={`Ordner in ${name} anlegen`}
            onClick={() => setNewFolder(true)}
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      {open &&
        [...children]
          .sort((a, b) => a.name.localeCompare(b.name, 'de'))
          .map((child) => (
            <FolderNode
              key={child.path}
              scope={scope}
              path={child.path}
              name={child.name}
              depth={depth + 1}
              canWrite={canWrite}
            />
          ))}
      {newFolder && (
        <FileNewFolderDialog scope={scope} folder={path} onClose={() => setNewFolder(false)} />
      )}
    </div>
  );
}

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
  return (
    listing.data?.items
      .filter((item) => isDirectChildFolder(item, ''))
      .sort((a, b) =>
        scope.kind === 'project'
          ? compareKnowledgeFolders(a.name, b.name)
          : a.name.localeCompare(b.name, 'de'),
      )
      .map((folder) => (
        <FolderNode
          key={folder.path}
          scope={scope}
          path={folder.path}
          name={folder.name}
          depth={depth}
          canWrite={canWrite}
        />
      )) ?? null
  );
}
