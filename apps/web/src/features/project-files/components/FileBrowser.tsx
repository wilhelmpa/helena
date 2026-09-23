import { useState } from 'react';
import FileViewer from '@/components/common/files/FileViewer';
import { fileRawUrl, type FileScope } from '@/lib/api/endpoints/projectFiles';
import { useFilesQuery } from '@/services/files.service';
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
  scope,
  path,
  selected,
  rootLabel,
  permissions,
  onNavigate,
  onSelect,
}: {
  scope: FileScope;
  path: string;
  selected: string | null;
  rootLabel: string;
  permissions: FilePermissions;
  onNavigate: (path: string) => void;
  onSelect: (file: string | null) => void;
}) {
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
  const items = visibleItems(listing.data?.items ?? [], view.filter, view.sort);
  const viewing = selected ? listing.data?.items.find((item) => item.path === selected) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3" {...transfers.dropHandlers}>
      <FileToolbar
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
        <FileViewer
          file={{
            name: viewing.name,
            contentType: viewing.contentType,
            sizeBytes: viewing.sizeBytes,
            url: fileRawUrl(scope, viewing.path),
            vaultPath: actions.vaultPath(viewing),
          }}
          actions={<FileViewerActions item={viewing} actions={actions} />}
          onClose={() => onSelect(null)}
        />
      )}
    </div>
  );
}
