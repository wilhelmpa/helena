import { useState, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { resolveVaultPath } from '@/lib/api/endpoints/knowledge';
import UnifiedFileViewer from './UnifiedFileViewer';
import VaultSearchResults from './VaultSearchResults';
import { fileRawUrl, type FileScope } from '@/lib/api/endpoints/projectFiles';
import { useFilesQuery, filesScopeKey } from '@/services/files.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { baseName } from '@/utils/vaultLinks';
import { codeFolderUrl } from '@/utils/workspaceTools';
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
}) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: filesScopeKey(scope) });
  };
  const listing = useFilesQuery(scope, path);
  const view = useFileBrowserView();
  const [dialog, setDialog] = useState<FileDialogState>(null);
  const writable = listing.data?.writable ?? false;
  const can = {
    create: permissions.create && writable,
    edit: permissions.edit && writable,
    delete: permissions.delete && writable,
  };
  const actions = useFileActions({
    scope,
    listing: listing.data,
    onNavigate,
    onSelect,
    ask: (kind, item) => setDialog({ kind, item }),
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
  const viewing = selected ? listing.data?.items.find((item) => item.path === selected) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3" {...transfers.dropHandlers}>
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
      <FileBreadcrumbs
        rootLabel={rootLabel}
        path={path}
        drag={transfers.drag}
        onNavigate={onNavigate}
      />
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
          />
        )}
      </div>
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

      {viewing && (
        <UnifiedFileViewer
          key={viewing.path}
          scope={scope}
          path={viewing.path}
          canEdit={can.edit}
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
      )}
    </div>
  );
}
