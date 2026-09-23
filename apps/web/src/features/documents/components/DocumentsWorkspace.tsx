'use client';

import { useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { vaultNotePath } from '@/utils/paths';
import { useCreateUntitledNote } from '../services/knowledge.service';
import { isNotePath } from '../utils/vaultPaths';
import DocumentEmptyState from './DocumentEmptyState';
import DocumentNote from './DocumentNote';
import DocumentSidebar from './DocumentSidebar';

// The Docs page of one vault folder (`root`): its tree beside the open note. The open
// note is the `path` of the address.
export default function DocumentsWorkspace({ root, canEdit }: { root: string; canEdit: boolean }) {
  const t = useTranslations('documents');
  const router = useRouter();
  const pathname = usePathname();
  const path = useSearchParams().get('path');
  const notePath = path && isNotePath(path) ? path : null;
  // Set by the open note's editor: saves its edits before the tree moves or trashes it.
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <DocumentSidebar
        className={cn(notePath && 'hidden md:flex')}
        root={root}
        openPath={notePath}
        canEdit={canEdit}
        creating={createNote.isPending}
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
            onClose={() => router.push(pathname)}
          />
        ) : (
          <DocumentEmptyState
            canEdit={canEdit}
            creating={createNote.isPending}
            onNewNote={() => newNote(root)}
          />
        )}
      </main>
    </div>
  );
}
