'use client';

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import type { VaultDocument } from '@/lib/api/endpoints/knowledge';
import { useNoteDraft } from '../hooks/useNoteDraft';
import { useVaultPathActions } from '../hooks/useVaultPathActions';
import { useWikilinkOpener } from '../hooks/useWikilinkOpener';
import DocumentConflictBanner from './DocumentConflictBanner';
import DocumentConflictCopies from './DocumentConflictCopies';
import DocumentEditorCanvas from './DocumentEditorCanvas';
import DocumentEditorDialogs, { type DocumentEditorDialog } from './DocumentEditorDialogs';
import { noteToolbarParts } from './DocumentEditorHeader';
import type { NoteToolbarParts } from './DocumentsToolbar';
import DocumentEditorInspector from './DocumentEditorInspector';

export default function DocumentEditor({
  root,
  document,
  canEdit,
  focusTitle,
  flushRef,
  toolbar,
  onClose,
}: {
  root: string;
  document: VaultDocument;
  canEdit: boolean;
  focusTitle: boolean;
  flushRef: RefObject<() => Promise<boolean>>;
  toolbar: (note?: NoteToolbarParts) => ReactNode;
  onClose: () => void;
}) {
  const t = useTranslations('documents');
  const path = document.path;
  // A note cut short by the API would lose its end on the next save.
  const editable = canEdit && !document.truncated;
  const note = useNoteDraft(document);
  const actions = useVaultPathActions({ root, openPath: path, flush: note.save });
  const openWikilink = useWikilinkOpener(path, root, canEdit);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [dialog, setDialog] = useState<DocumentEditorDialog | null>(null);
  const conflict = note.draft.status === 'conflict';

  useEffect(() => {
    flushRef.current = note.save;
    return () => {
      flushRef.current = async () => true;
    };
  }, [flushRef, note.save]);

  useEffect(() => {
    if (conflict) setDialog('conflict');
  }, [conflict]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {toolbar(
          noteToolbarParts({
            root,
            document,
            status: note.draft.status,
            dirty: note.dirty,
            editable,
            inspectorOpen,
            labels: {
              back: t('backToDocuments'),
              openDetails: t('openDetails'),
              closeDetails: t('closeDetails'),
            },
            onBack: onClose,
            onRetrySave: () => void note.save(),
            onToggleInspector: () => setInspectorOpen((open) => !open),
            onOpenDialog: setDialog,
          }),
        )}
        {conflict && dialog !== 'conflict' && (
          <DocumentConflictBanner onReview={() => setDialog('conflict')} />
        )}
        <DocumentConflictCopies root={root} path={path} canEdit={canEdit} />
        <DocumentEditorCanvas
          path={path}
          updatedAt={document.updatedAt}
          truncated={document.truncated}
          loaded={note.draft.loaded}
          editor={editor}
          editable={editable}
          focusTitle={focusTitle}
          onEditorReady={setEditor}
          onLoaded={note.ready}
          onEdit={note.edit}
          onBlur={() => void note.save()}
          onRename={(name) => actions.rename(path, name)}
          onOpenWikilink={(inner) => void openWikilink(inner)}
        />
      </section>

      <DocumentEditorInspector
        open={inspectorOpen}
        revision={note.draft.loaded.revision}
        path={path}
        frontmatter={note.draft.current.frontmatter}
        editable={editable}
        onFrontmatterChange={note.setFrontmatter}
        onOpenChange={setInspectorOpen}
      />

      <DocumentEditorDialogs
        dialog={dialog}
        root={root}
        path={path}
        note={note}
        editable={editable}
        actions={actions}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
