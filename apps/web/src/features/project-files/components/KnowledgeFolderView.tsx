'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MoreHorizontal } from 'lucide-react';
import {
  Menu as DropdownMenu,
  MenuContent as DropdownMenuContent,
  MenuItem as DropdownMenuItem,
  MenuTrigger as DropdownMenuTrigger,
} from '@/design-system';
import type { KnowledgeCrumb } from '@/components/helena/KnowledgeFrame';
import DocumentTemplateDialog from '@/features/documents/components/DocumentTemplateDialog';
import { toast } from 'sonner';
import { childPath, parentPath } from '@/utils/vaultLinks';
import { useMoveFile } from '../services/projectFiles.service';
import { useOpenDailyNoteMutation } from '@/services/everything.service';
import { useProjectQuery } from '@/services/projects.service';
import { vaultNotePath } from '@/utils/paths';
import type { FileItem, FileScope } from '@/lib/api/endpoints/projectFiles';
import { describeFolder, folderPathLabels } from '@/utils/knowledgeFolders';
import type { FileActions } from '../hooks/useFileActions';
import type { FileEntryDrag } from '../hooks/useFileEntryDrag';
import { isCanvas, isDoc, renamedFileName } from '../utils/knowledgeKinds';
import type { FilePermissions } from './FileBrowser';
import FileItemMenu from './FileItemMenu';
import KnowledgeListView, { type KnowledgeEntry } from './KnowledgeListView';

export function vaultRootOf(scope: FileScope): string {
  return scope.kind === 'project'
    ? `Projects/${scope.projectKey}`
    : scope.root === 'home'
      ? 'Home'
      : scope.root === 'private'
        ? 'Private'
        : 'Templates';
}

export function folderItem(path: string): FileItem {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    kind: 'folder',
    contentType: null,
    sizeBytes: null,
    updatedAt: null,
  };
}

// The eyebrow path of a Wissen page: project (or Home root) · Wissen / folder / …, each
// segment leading to its folder.
export function useKnowledgeCrumbs(
  scope: FileScope,
  segments: string[],
  open: (folder: string) => void,
  atRoot = false,
): KnowledgeCrumb[] {
  const roots = useTranslations('files.roots');
  const fixed = useTranslations('files.fixedFolders');
  const project = useProjectQuery(scope.kind === 'project' ? scope.projectKey : null);
  return [
    {
      label:
        scope.kind === 'project'
          ? project.data?.project.name || scope.projectKey
          : roots(scope.root),
    },
    { label: roots('vault'), onSelect: atRoot ? undefined : () => open('') },
    ...folderPathLabels(segments, fixed, scope.kind === 'project').map((label, index) => ({
      label,
      onSelect: () => open(segments.slice(0, index + 1).join('/')),
    })),
  ];
}

// A Wissen folder (WissenOrdner.dc.html): its files, the selected one previewed on the
// right. Its subfolders are only in the sidebar tree; the page names how many there are.
export default function KnowledgeFolderView({
  scope,
  path,
  items,
  loading,
  actions,
  can,
  drag,
  onOpen,
  onNewFile,
  onNewCanvas,
  onNewBase,
  onNewFolder,
  onUpload,
}: {
  scope: FileScope;
  path: string;
  items: FileItem[];
  loading: boolean;
  actions: FileActions;
  can: FilePermissions;
  drag: FileEntryDrag;
  onOpen: (item: FileItem) => void;
  onNewFile: () => void;
  onNewCanvas: () => void;
  onNewBase: () => void;
  onNewFolder: () => void;
  onUpload: (files: File[]) => void;
}) {
  const t = useTranslations('files.knowledge');
  const fixed = useTranslations('files.fixedFolders');
  const roots = useTranslations('files.roots');
  const [templateOpen, setTemplateOpen] = useState(false);
  const tFiles = useTranslations('files');
  const move = useMoveFile(scope);
  const router = useRouter();
  const daily = useOpenDailyNoteMutation();
  const project = useProjectQuery(scope.kind === 'project' ? scope.projectKey : null);
  const root = vaultRootOf(scope);
  const segments = path ? path.split('/') : [];
  const crumbs = useKnowledgeCrumbs(scope, segments.slice(0, -1), (folder) =>
    actions.open(folderItem(folder)),
  );
  const title =
    segments.length === 0
      ? scope.kind === 'project'
        ? project.data?.project.name || scope.projectKey
        : roots(scope.root)
      : describeFolder(path, fixed, scope.kind === 'project').label;
  const rank = (item: FileItem) => (isCanvas(item.name) ? 0 : isDoc(item.name) ? 1 : 2);
  const entries: KnowledgeEntry[] = items
    .filter((item) => item.kind === 'file')
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
        a.name.localeCompare(b.name, 'de'),
    )
    .map((item) => ({ key: item.path, item, scope, vaultPath: actions.vaultPath(item) }));
  const subfolders = items
    .filter((item) => item.kind === 'folder')
    .map((item) => {
      const info = describeFolder(item.path, fixed, scope.kind === 'project');
      return { name: info.label, path: item.path, icon: info.Icon, kind: info.kind };
    });

  const more = scope.kind === 'home' && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={t('more')} className="ds-icon-button">
          <MoreHorizontal size={17} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {scope.root === 'home' && can.create && (
          <DropdownMenuItem
            onSelect={() =>
              daily.mutate(undefined, {
                onSuccess: (note) => router.push(vaultNotePath(note.path)),
              })
            }
          >
            {t('today')}
          </DropdownMenuItem>
        )}
        {can.create && (
          <DropdownMenuItem onSelect={() => setTemplateOpen(true)}>
            {t('fromTemplate')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => {
            // The place's Papierkorb is a view of its own now (Auftrag 117).
            const query = new URLSearchParams(window.location.search);
            query.set('trash', '1');
            router.push(`${window.location.pathname}?${query.toString()}`);
          }}
        >
          {t('trash')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <KnowledgeListView
        crumbs={crumbs}
        title={title}
        entries={entries}
        loading={loading}
        searchRoots={[{ root, scope }]}
        can={can}
        onOpen={(entry) => onOpen(entry.item)}
        onCreate={(kind) =>
          kind === 'doc'
            ? onNewFile()
            : kind === 'canvas'
              ? onNewCanvas()
              : kind === 'base'
                ? onNewBase()
                : onNewFolder()
        }
        kind="all"
        onUpload={onUpload}
        menuFor={(entry, helpers) => (
          <FileItemMenu item={entry.item} actions={actions} can={can} onRename={helpers.rename} />
        )}
        rowPropsFor={(entry) => drag.source(entry.item)}
        onRename={(entry, typed) => {
          const name = renamedFileName(entry.item.name, typed);
          move.mutate(
            { from: entry.item.path, to: childPath(parentPath(entry.item.path), name) },
            { onSuccess: () => toast.success(tFiles('renamed', { name })) },
          );
        }}
        onTrash={(entry) => actions.ask('trash', entry.item)}
        more={more}
        subfolders={subfolders}
        onOpenFolder={(folder) => actions.open(folderItem(folder))}
        emptyText={t('emptyFolder')}
      />
      {templateOpen && (
        <DocumentTemplateDialog
          folder={`${root}${path ? `/${path}` : ''}`}
          onCreated={(created) => router.push(vaultNotePath(created))}
          onClose={() => setTemplateOpen(false)}
        />
      )}
    </>
  );
}
