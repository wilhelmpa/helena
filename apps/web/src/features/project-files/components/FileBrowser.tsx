import { useState, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { resolveVaultPath } from '@/lib/api/endpoints/knowledge';
import UnifiedFileViewer from './UnifiedFileViewer';
import VaultSearchResults from './VaultSearchResults';
import { fileRawUrl, type FileScope } from '@/lib/api/endpoints/projectFiles';
import { useFilesQuery, filesScopeKey } from '@/services/files.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { baseName } from '@/utils/vaultLinks';
import { codeFolderUrl } from '@/utils/workspaceTools';
import { useFileNavigationGuard } from '../hooks/useFileNavigationGuard';
import { useFileActions } from '../hooks/useFileActions';
import { useFileBrowserView } from '../hooks/useFileBrowserView';
import { useFileTransfers } from '../hooks/useFileTransfers';
import { visibleItems } from '../utils/fileSort';
import FileBreadcrumbs from './FileBreadcrumbs';
import FileBrowserDialogs, { type FileDialogState } from './FileBrowserDialogs';
import FileDropOverlay from './FileDropOverlay';
import FileFolderContent from './FileFolderContent';
import FileToolbar from './FileToolbar';
import FileViewerActions from './FileViewerActions';
import ProjectKnowledgeViewer from './ProjectKnowledgeViewer';
import KnowledgeFolderView, { useKnowledgeCrumbs, vaultRootOf } from './KnowledgeFolderView';
import KnowledgeRecentView from './KnowledgeRecentView';
import KnowledgeTrashView from './KnowledgeTrashView';
import { useSearchParams } from 'next/navigation';
import KnowledgeCanvas from './KnowledgeCanvas';
import KnowledgeBaseView from './KnowledgeBaseView';
import { Page } from '@/design-system';
import FileCreateMenu from './FileCreateMenu';
import FileActionBar from './FileActionBar';
import FileItemMenu from './FileItemMenu';

export interface FilePermissions {
  create: boolean;
  edit: boolean;
  delete: boolean;
}

// One folder of a scope: the toolbar, the path, the entries, uploads dropped onto it,
// entries dragged onto folders, the dialogs of its actions and the viewer of the file
// `selected` names.
export default function FileBrowser({
  leading,
  scope,
  path,
  selected,
  rootLabel,
  permissions,
  onNavigate,
  onSelect,
  onDirtyChange,
  sourceOnly = false,
  createRequest,
  onCreateHandled,
}: {
  // The page's own controls that lead the header toolbar (the project's Wissen/Code tabs).
  leading?: ReactNode;
  scope: FileScope;
  path: string;
  selected: string | null;
  rootLabel: string;
  permissions: FilePermissions;
  onNavigate: (path: string) => void;
  onSelect: (file: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  sourceOnly?: boolean;
  createRequest?: string | null;
  onCreateHandled?: () => void;
}) {
  const client = useQueryClient();
  const { onDirty, canLeave } = useFileNavigationGuard(onDirtyChange);
  const navigate = (next: string) => {
    if (canLeave()) onNavigate(next);
  };
  const select = (next: string | null) => {
    if (canLeave()) onSelect(next);
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: filesScopeKey(scope) });
  };
  const listing = useFilesQuery(scope, path);
  // Wissen › Papierkorb (?trash=1): what was trashed below this place, to restore.
  const trashView = useSearchParams()?.get('trash') === '1';
  const view = useFileBrowserView();
  const [dialog, setDialog] = useState<FileDialogState>(null);
  const writable = listing.data?.writable ?? false;
  const can = {
    create: permissions.create && writable,
    edit: permissions.edit && writable,
    delete: permissions.delete && writable,
  };
  useEffect(() => {
    if (!createRequest || !can.create) return;
    if (createRequest !== 'doc' && createRequest !== 'folder') return;
    queueMicrotask(() => {
      setDialog({ kind: createRequest === 'doc' ? 'newFile' : 'newFolder' });
      onCreateHandled?.();
    });
  }, [createRequest, can.create, onCreateHandled]);
  const actions = useFileActions({
    scope,
    inlineMarkdown: scope.kind === 'home' || scope.root === 'vault',
    listing: listing.data,
    onNavigate: navigate,
    onSelect: select,
    ask: (kind, item) => {
      if (canLeave()) setDialog({ kind, item });
    },
  });
  const transfers = useFileTransfers({
    scope,
    folder: path,
    rootLabel,
    canUpload: can.create,
    canMove: can.edit,
  });
  const workspace = runtimeEnv().workspace;
  const folderCodeUrl = listing.data ? codeFolderUrl(workspace, listing.data.absolutePath) : '';
  const vaultRoot =
    scope.kind === 'project'
      ? scope.root === 'vault'
        ? `Projects/${scope.projectKey}`
        : null
      : scope.root === 'home'
        ? 'Home'
        : scope.root === 'private'
          ? 'Private'
          : 'Templates';
  useEffect(() => {
    if (
      !selected ||
      !vaultRoot ||
      listing.isPending ||
      listing.data?.items.some((item) => item.path === selected)
    )
      return;
    let active = true;
    const original = `${vaultRoot}/${selected}`;
    void resolveVaultPath(original)
      .then((result) => {
        if (
          active &&
          result.path &&
          result.path !== original &&
          result.path.startsWith(`${vaultRoot}/`)
        )
          onSelect(result.path.slice(vaultRoot.length + 1));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selected, vaultRoot, listing.isPending, listing.data, onSelect]);
  const items = visibleItems(listing.data?.items ?? [], view.filter, view.sort);
  // Level 1 of a place of Wissen (a project's folder, Helena, Privat, Vorlagen): the latest
  // files across all its folders, never a list of folders under empty column heads (O14).
  const levelOne = (scope.kind === 'home' || scope.root === 'vault') && !path;
  const levelOneCrumbs = useKnowledgeCrumbs(scope, [], (folder) => navigate(folder), true);
  const k = useTranslations('files.knowledge');
  const viewing = selected ? listing.data?.items.find((item) => item.path === selected) : undefined;
  const knowledge = scope.kind === 'home' || scope.root === 'vault';

  return (
    <div
      className={
        knowledge && viewing
          ? 'relative flex min-h-0 flex-1 flex-col'
          : 'relative flex min-h-0 flex-1 flex-col gap-3'
      }
      {...transfers.dropHandlers}
      onClickCapture={(event) => {
        const target = event.target as Element;
        if (
          !target.closest('[data-file-preview]') &&
          target.closest('a[href^="/"]') &&
          !canLeave()
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {!knowledge && (
        <FileToolbar
          leading={leading}
          view={view}
          canCreate={can.create}
          codeUrl={folderCodeUrl}
          uploading={transfers.uploading}
          onUpload={transfers.sendFiles}
          onNewFolder={() => setDialog({ kind: 'newFolder' })}
          onNewFile={() => setDialog({ kind: 'newFile' })}
        />
      )}
      {!knowledge && (
        <FileBreadcrumbs
          rootLabel={rootLabel}
          path={path}
          drag={transfers.drag}
          onNavigate={navigate}
        />
      )}
      {viewing ? (
        knowledge && /\.canvas$/i.test(viewing.name) ? (
          <KnowledgeCanvas
            key={viewing.path}
            scope={scope}
            path={viewing.path}
            name={viewing.name}
            editable={can.edit}
            item={viewing}
            actions={actions}
            can={can}
          />
        ) : knowledge && /\.base$/i.test(viewing.name) && vaultRoot ? (
          <Page
            actions={<FileItemMenu item={viewing} actions={actions} can={can} size="default" />}
          >
            <KnowledgeBaseView
              key={viewing.path}
              path={`${vaultRoot}/${viewing.path}`}
              onOpenNote={(note) => {
                if (!note.startsWith(`${vaultRoot}/`)) return;
                const relative = note.slice(vaultRoot.length + 1);
                actions.open({
                  name: baseName(relative),
                  path: relative,
                  kind: 'file',
                  sizeBytes: null,
                  contentType: null,
                  updatedAt: null,
                });
              }}
            />
          </Page>
        ) : knowledge ? (
          <ProjectKnowledgeViewer
            key={viewing.path}
            scope={scope}
            path={viewing.path}
            item={viewing}
            canEdit={can.edit}
            canDelete={can.delete}
            sourceOnly={sourceOnly}
            actions={actions}
            onDirty={onDirty}
            file={{
              name: viewing.name,
              contentType: viewing.contentType,
              sizeBytes: viewing.sizeBytes,
              url: fileRawUrl(scope, viewing.path),
              vaultPath: actions.vaultPath(viewing),
            }}
          />
        ) : (
          <UnifiedFileViewer
            key={viewing.path}
            scope={scope}
            path={viewing.path}
            canEdit={can.edit}
            onDirty={onDirty}
            sourceOnly={sourceOnly}
            file={{
              name: viewing.name,
              contentType: viewing.contentType,
              sizeBytes: viewing.sizeBytes,
              url: fileRawUrl(scope, viewing.path),
              vaultPath: actions.vaultPath(viewing),
            }}
            actions={<FileViewerActions item={viewing} actions={actions} />}
            onClose={() => {
              onSelect(null);
              refresh();
            }}
          />
        )
      ) : trashView && knowledge ? (
        <KnowledgeTrashView
          root={vaultRootOf(scope)}
          title={k('trash')}
          canRestore={permissions.create || permissions.edit}
        />
      ) : levelOne ? (
        <KnowledgeRecentView
          sources={[{ root: vaultRootOf(scope), scope }]}
          crumbs={levelOneCrumbs}
          title={k('recent')}
          can={can}
          onOpen={(entry) => actions.open(entry.item)}
          onCreate={(kind) =>
            setDialog({
              kind:
                kind === 'doc'
                  ? 'newFile'
                  : kind === 'canvas'
                    ? 'newCanvas'
                    : kind === 'base'
                      ? 'newBase'
                      : 'newFolder',
            })
          }
          onUpload={transfers.sendFiles}
          menuFor={(entry) => <FileItemMenu item={entry.item} actions={actions} can={can} />}
          actionBarFor={(entry) => <FileActionBar item={entry.item} actions={actions} can={can} />}
        />
      ) : knowledge ? (
        <KnowledgeFolderView
          loading={listing.isPending}
          scope={scope}
          path={path}
          items={items}
          actions={actions}
          can={can}
          drag={transfers.drag}
          onOpen={actions.open}
          onNewFile={() => setDialog({ kind: 'newFile' })}
          onNewCanvas={() => setDialog({ kind: 'newCanvas' })}
          onNewBase={() => setDialog({ kind: 'newBase' })}
          onNewFolder={() => setDialog({ kind: 'newFolder' })}
          onUpload={transfers.sendFiles}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {view.filter.trim() && vaultRoot ? (
            <VaultSearchResults query={view.filter.trim()} root={vaultRoot} />
          ) : (
            <FileFolderContent
              listing={listing}
              items={items}
              filter={view.filter}
              mode={view.mode}
              scope={scope}
              actions={actions}
              can={can}
              drag={transfers.drag}
              selected={selected}
              codeUrl={folderCodeUrl}
              createAction={
                can.create ? (
                  <FileCreateMenu
                    onNewFile={() => setDialog({ kind: 'newFile' })}
                    onNewFolder={() => setDialog({ kind: 'newFolder' })}
                    onUpload={transfers.sendFiles}
                    projectKey={scope.kind === 'project' ? scope.projectKey : null}
                    uploading={transfers.uploading}
                  />
                ) : undefined
              }
            />
          )}
        </div>
      )}
      {transfers.draggedFiles !== null && (
        <FileDropOverlay folder={path ? baseName(path) : rootLabel} />
      )}

      <FileBrowserDialogs
        scope={scope}
        folder={path}
        dialog={dialog}
        projectKey={actions.projectKey}
        onCreatedFile={(created) =>
          actions.open({
            name: baseName(created),
            path: created,
            kind: 'file',
            sizeBytes: 0,
            contentType: null,
            updatedAt: null,
          })
        }
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
