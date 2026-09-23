'use client';

import { useState } from 'react';
import { ArrowLeft, FilePlus2, FolderPlus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import DocumentIconButton from './DocumentIconButton';
import DocumentSyncConflicts from './DocumentSyncConflicts';
import DocumentTrashList from './DocumentTrashList';
import DocumentTree from './DocumentTree';
import DocumentTreeDialog, { type DocumentTreeAction } from './DocumentTreeDialog';

export default function DocumentSidebar({
  className,
  root,
  openPath,
  canEdit,
  creating,
  onNewNote,
  flush,
}: {
  className?: string;
  root: string;
  openPath: string | null;
  canEdit: boolean;
  creating: boolean;
  onNewNote: (folder: string) => void;
  flush: () => Promise<boolean>;
}) {
  const t = useTranslations('documents');
  const [showTrash, setShowTrash] = useState(false);
  const [action, setAction] = useState<DocumentTreeAction | null>(null);

  return (
    <aside
      className={cn('flex w-full shrink-0 flex-col border-e bg-muted/10 md:w-72', className)}
      aria-label={t('treeLabel')}
    >
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b px-3">
        {showTrash && (
          <DocumentIconButton label={t('backToDocuments')} onClick={() => setShowTrash(false)}>
            <ArrowLeft className="rtl:rotate-180" />
          </DocumentIconButton>
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {showTrash ? t('trash') : t('title')}
        </h2>
        {!showTrash && canEdit && (
          <>
            <DocumentIconButton
              label={t('newNote')}
              disabled={creating}
              onClick={() => onNewNote(root)}
            >
              <FilePlus2 />
            </DocumentIconButton>
            <DocumentIconButton
              label={t('newFolder')}
              onClick={() => setAction({ kind: 'newFolder', path: root })}
            >
              <FolderPlus />
            </DocumentIconButton>
          </>
        )}
        {!showTrash && (
          <DocumentIconButton label={t('trash')} onClick={() => setShowTrash(true)}>
            <Trash2 />
          </DocumentIconButton>
        )}
      </div>
      <DocumentSyncConflicts root={root} />
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {showTrash ? (
          <DocumentTrashList root={root} canEdit={canEdit} />
        ) : (
          <DocumentTree
            root={root}
            openPath={openPath}
            canEdit={canEdit}
            onNewNote={onNewNote}
            onAction={setAction}
          />
        )}
      </div>
      {action && (
        <DocumentTreeDialog
          action={action}
          root={root}
          openPath={openPath}
          flush={flush}
          onClose={() => setAction(null)}
        />
      )}
    </aside>
  );
}
