import type { FileItem, FileScope } from '@/lib/api/endpoints/projectFiles';
import FileLinkTaskDialog from './FileLinkTaskDialog';
import FileMoveDialog from './FileMoveDialog';
import FileNewFolderDialog from './FileNewFolderDialog';
import FileNewNoteDialog from './FileNewNoteDialog';
import FileRenameDialog from './FileRenameDialog';
import FileTrashDialog from './FileTrashDialog';
import FileNewCanvasDialog from './FileNewCanvasDialog';
import FileNewBaseDialog from './FileNewBaseDialog';

export type FileDialogState =
  | { kind: 'newFolder' | 'newFile' | 'newCanvas' | 'newBase' }
  | { kind: 'rename' | 'move' | 'trash' | 'link'; item: FileItem }
  | null;

// The dialog the Files page has open.
export default function FileBrowserDialogs({
  scope,
  folder,
  dialog,
  projectKey,
  onCreatedFile,
  onClose,
}: {
  scope: FileScope;
  folder: string;
  dialog: FileDialogState;
  projectKey: string | null;
  onCreatedFile: (path: string) => void;
  onClose: () => void;
}) {
  switch (dialog?.kind) {
    case 'newFolder':
      return <FileNewFolderDialog scope={scope} folder={folder} onClose={onClose} />;
    case 'newFile':
      return (
        <FileNewNoteDialog
          scope={scope}
          folder={folder}
          onCreated={onCreatedFile}
          onClose={onClose}
        />
      );
    case 'newCanvas':
      return (
        <FileNewCanvasDialog
          scope={scope}
          folder={folder}
          onCreated={onCreatedFile}
          onClose={onClose}
        />
      );
    case 'newBase':
      return (
        <FileNewBaseDialog
          scope={scope}
          folder={folder}
          onCreated={onCreatedFile}
          onClose={onClose}
        />
      );
    case 'rename':
      return <FileRenameDialog scope={scope} item={dialog.item} onClose={onClose} />;
    case 'move':
      return <FileMoveDialog scope={scope} item={dialog.item} onClose={onClose} />;
    case 'trash':
      return <FileTrashDialog scope={scope} item={dialog.item} onClose={onClose} />;
    case 'link':
      return projectKey ? (
        <FileLinkTaskDialog projectKey={projectKey} path={dialog.item.path} onClose={onClose} />
      ) : null;
    default:
      return null;
  }
}
