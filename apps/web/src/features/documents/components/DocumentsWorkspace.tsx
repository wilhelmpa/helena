'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, FilePlus2, FolderPlus, Trash2 } from 'lucide-react';
import type { PageAction } from '@/components/layout/PageToolbar';
import { cn } from '@/lib/utils';
import { vaultNotePath } from '@/utils/paths';
import { useCreateUntitledNote } from '../services/knowledge.service';
import { isNotePath } from '../utils/vaultPaths';
import DocumentEmptyState from './DocumentEmptyState';
import DocumentNote from './DocumentNote';
import DocumentSidebar from './DocumentSidebar';
import DocumentsToolbar, { type NoteToolbarParts } from './DocumentsToolbar';
import type { DocumentTreeAction } from './DocumentTreeDialog';

// The Docs page of one vault folder (`root`): its tree beside the open note. The open
// note is the `path` of the address. The page's header row carries the tree's actions
// (new note, new folder, trash) and, while a note is open, the note's (see
// DocumentEditor).
export default function DocumentsWorkspace({ root, canEdit }: { root: string; canEdit: boolean }) {
  const t = useTranslations('documents');
  const router = useRouter();
  const pathname = usePathname();
  const path = useSearchParams().get('path');
  const notePath = path && isNotePath(path) ? path : null;
  // Set by the open note's editor: saves its edits before the tree moves or trashes it.
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [treeAction, setTreeAction] = useState<DocumentTreeAction | null>(null);
  const createNote = useCreateUntitledNote(root);

  const newNote = (folder: string) =>
    createNote.mutate(
      { folder, name: t('untitled') },
      {
        onSuccess: (created) => {
          setCreatedPath(created);
          router.push(vaultNotePath(created));
        },
      },
    );

  const actions: PageAction[] = [];
  if (canEdit && !showTrash)
    actions.push({
      id: 'new-folder',
      label: t('newFolder'),
      icon: FolderPlus,
      onClick: () => setTreeAction({ kind: 'newFolder', path: root }),
    });
  actions.push(
    showTrash
      ? {
          id: 'trash',
          label: t('backToDocuments'),
          icon: ArrowLeft,
          onClick: () => setShowTrash(false),
        }
      : { id: 'trash', label: t('trash'), icon: Trash2, onClick: () => setShowTrash(true) },
  );
  const primary = canEdit
    ? {
        id: 'new-note',
        label: t('newNote'),
        icon: FilePlus2,
        disabled: createNote.isPending,
        onClick: () => newNote(root),
      }
    : undefined;
  const toolbar = (note?: NoteToolbarParts) => (
    <DocumentsToolbar note={note} actions={actions} primary={primary} />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {!notePath && toolbar()}
      <DocumentSidebar
        className={cn(notePath && 'hidden md:flex')}
        root={root}
        openPath={notePath}
        canEdit={canEdit}
        showTrash={showTrash}
        onCloseTrash={() => setShowTrash(false)}
        action={treeAction}
        onAction={setTreeAction}
        onNewNote={newNote}
        flush={() => flushRef.current()}
      />
      <main
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-hidden bg-background',
          !notePath && 'hidden md:flex',
        )}
      >
        {notePath ? (
          <DocumentNote
            key={notePath}
            root={root}
            path={notePath}
            canEdit={canEdit}
            focusTitle={notePath === createdPath}
            flushRef={flushRef}
            toolbar={toolbar}
            onClose={() => router.push(pathname)}
          />
        ) : (
          <DocumentEmptyState />
        )}
      </main>
    </div>
  );
}
