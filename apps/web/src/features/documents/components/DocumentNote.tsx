'use client';

import WebLinkScope from '@/components/common/WebLinkScope';
import { vaultProjectKey } from '@/utils/vaultLinks';
import { useEffect, type ReactNode, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/common/page/EmptyState';
import { Button } from '@/components/ui/button';
import { vaultNotePath } from '@/utils/paths';
import {
  isApiStatus,
  useResolvedPathQuery,
  useVaultNoteQuery,
} from '../services/knowledge.service';
import DocumentEditor from './DocumentEditor';
import DocumentLoadError from './DocumentLoadError';
import DocumentLoadingState from './DocumentLoadingState';
import type { NoteToolbarParts } from './DocumentsToolbar';

// Loads the note of the address. A note that is gone from its path is looked up where
// it was moved to, and the address follows it.
export default function DocumentNote({
  root,
  path,
  canEdit,
  focusTitle,
  flushRef,
  toolbar,
  onClose,
}: {
  root: string;
  path: string;
  canEdit: boolean;
  focusTitle: boolean;
  flushRef: RefObject<() => Promise<boolean>>;
  // The page's header row; the editor adds the note's parts once it has loaded.
  toolbar: (note?: NoteToolbarParts) => ReactNode;
  onClose: () => void;
}) {
  const t = useTranslations('documents');
  const router = useRouter();
  const note = useVaultNoteQuery(path);
  const missing = isApiStatus(note.error, 404);
  const resolved = useResolvedPathQuery(path, missing);
  const movedTo = resolved.data?.path;

  useEffect(() => {
    if (movedTo && movedTo !== path) router.replace(vaultNotePath(movedTo));
  }, [movedTo, path, router]);

  if (missing) {
    if (resolved.isPending || (movedTo && movedTo !== path))
      return (
        <>
          {toolbar()}
          <DocumentLoadingState />
        </>
      );
    return (
      <>
        {toolbar()}
        <EmptyState title={t('notFoundTitle')} description={t('notFoundDescription')}>
          <Button size="sm" variant="outline" onClick={onClose}>
            {t('backToDocuments')}
          </Button>
        </EmptyState>
      </>
    );
  }
  // A failed refetch keeps the note open with the data it has.
  if (!note.data) {
    return (
      <>
        {toolbar()}
        {note.isError ? (
          <DocumentLoadError onRetry={() => void note.refetch()} />
        ) : (
          <DocumentLoadingState />
        )}
      </>
    );
  }

  return (
    <WebLinkScope projectKey={vaultProjectKey(note.data.path)}>
      <DocumentEditor
        root={root}
        document={note.data}
        canEdit={canEdit}
        focusTitle={focusTitle}
        flushRef={flushRef}
        toolbar={toolbar}
        onClose={onClose}
      />
    </WebLinkScope>
  );
}
