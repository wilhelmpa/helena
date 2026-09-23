'use client';

import { useTranslations } from 'next-intl';
import NameDialog from '@/components/common/overlay/NameDialog';
import { useVaultPathActions } from '../hooks/useVaultPathActions';
import { useCreateFolder } from '../services/knowledge.service';
import { cleanFileName, joinPath, noteName } from '../utils/vaultPaths';
import DocumentMoveDialog from './DocumentMoveDialog';
import DocumentTrashDialog from './DocumentTrashDialog';

// `path` is the folder a new folder goes into, or the note or folder acted on.
export interface DocumentTreeAction {
  kind: 'newFolder' | 'rename' | 'move' | 'trash';
  path: string;
}

export default function DocumentTreeDialog({
  action,
  root,
  openPath,
  flush,
  onClose,
}: {
  action: DocumentTreeAction;
  root: string;
  openPath: string | null;
  flush: () => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('documents');
  const actions = useVaultPathActions({ root, openPath, flush });
  const createFolder = useCreateFolder(root);
  const { kind, path } = action;

  switch (kind) {
    case 'newFolder':
      return (
        <NameDialog
          title={t('newFolder')}
          label={t('name')}
          submitLabel={t('create')}
          onSubmit={async (name) => {
            const clean = cleanFileName(name);
            if (clean) await createFolder.mutateAsync(joinPath(path, clean));
          }}
          onClose={onClose}
        />
      );
    case 'rename':
      return (
        <NameDialog
          title={t('rename')}
          label={t('name')}
          initialName={noteName(path)}
          maxLength={200}
          submitLabel={t('rename')}
          onSubmit={(name) => actions.rename(path, name)}
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
  }
}
