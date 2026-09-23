'use client';

import type { NoteDraftControls } from '../hooks/useNoteDraft';
import type { VaultPathActions } from '../hooks/useVaultPathActions';
import { useRestoreNoteVersion } from '../services/knowledge.service';
import { frontmatterToKeep } from '../utils/noteDraft';
import { noteName } from '../utils/vaultPaths';
import DocumentConflictDialog from './DocumentConflictDialog';
import DocumentHistoryDialog from './DocumentHistoryDialog';
import DocumentMoveDialog from './DocumentMoveDialog';
import DocumentTrashDialog from './DocumentTrashDialog';

export type DocumentEditorDialog = 'history' | 'move' | 'trash' | 'conflict';

export default function DocumentEditorDialogs({
  dialog,
  root,
  path,
  note,
  editable,
  actions,
  onClose,
}: {
  dialog: DocumentEditorDialog | null;
  root: string;
  path: string;
  note: NoteDraftControls;
  editable: boolean;
  actions: VaultPathActions;
  onClose: () => void;
}) {
  const restore = useRestoreNoteVersion(path);

  switch (dialog) {
    case 'history':
      return (
        <DocumentHistoryDialog
          path={path}
          canRestore={editable}
          onRestore={async (content) => {
            if (!(await note.save())) return;
            await restore.mutateAsync({ content, expectedSha: note.sha() });
            onClose();
          }}
          onClose={onClose}
        />
      );
    case 'move':
      return (
        <DocumentMoveDialog
          root={root}
          path={path}
          onMove={(folder) => actions.moveTo(path, folder)}
          onClose={onClose}
        />
      );
    case 'trash':
      return (
        <DocumentTrashDialog
          name={noteName(path)}
          onConfirm={() => actions.remove(path)}
          onClose={onClose}
        />
      );
    case 'conflict':
      return (
        <DocumentConflictDialog
          path={path}
          mine={note.draft.current.body}
          frontmatterFor={(theirs) => frontmatterToKeep(note.draft, theirs)}
          onResolved={(sha, snapshot) => {
            note.load(sha, snapshot);
            onClose();
          }}
          onClose={onClose}
        />
      );
    default:
      return null;
  }
}
