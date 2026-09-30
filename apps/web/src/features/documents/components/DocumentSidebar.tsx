'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import DocumentSyncConflicts from './DocumentSyncConflicts';
import DocumentTrashList from './DocumentTrashList';
import DocumentTree from './DocumentTree';
import DocumentTreeDialog, { type DocumentTreeAction } from './DocumentTreeDialog';

// The tree of the Docs page (or its trash), on the sidebar's surface. Its actions (new
// note, new folder, trash) are in the page's header row (DocumentsWorkspace), so the
// pane has no header of its own; in the trash a short row names it and leads back.
export default function DocumentSidebar({
  className,
  root,
  openPath,
  canEdit,
  showTrash,
  onCloseTrash,
  action,
  onAction,
  onNewNote,
  flush,
}: {
  className?: string;
  root: string;
  openPath: string | null;
  canEdit: boolean;
  showTrash: boolean;
  onCloseTrash: () => void;
  action: DocumentTreeAction | null;
  onAction: (action: DocumentTreeAction | null) => void;
  onNewNote: (folder: string) => void;
  flush: () => Promise<boolean>;
}) {
  const t = useTranslations('documents');

  return (
    <aside
      className={cn('ds-pane flex w-full shrink-0 flex-col md:w-72', className)}
      aria-label={t('treeLabel')}
    >
      {showTrash && (
        <button
          type="button"
          onClick={onCloseTrash}
          className="mx-2 mt-2 flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-sidebar-accent/60"
        >
          <ArrowLeft className="size-4 text-muted-foreground rtl:rotate-180" />
          {t('trash')}
        </button>
      )}
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
            onAction={onAction}
          />
        )}
      </div>
      {action && (
        <DocumentTreeDialog
          action={action}
          root={root}
          openPath={openPath}
          flush={flush}
          onClose={() => onAction(null)}
        />
      )}
    </aside>
  );
}
