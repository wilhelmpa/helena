'use client';

import { useCallback, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { useUploadNoteAsset } from '../services/knowledge.service';
import type { NoteDraft } from '../utils/noteDraft';
import { fromEditorImages, toEditorImages } from '../utils/vaultImages';
import { noteName } from '../utils/vaultPaths';
import DocumentMarkdownEditor, { insertDocumentImage } from './DocumentMarkdownEditor';
import DocumentPageTitle from './DocumentPageTitle';
import DocumentToolbar from './DocumentToolbar';

// The note as the editor shows it. The editor works on image URLs the browser can
// load; every body it reports is turned back into the note's own image links.
export default function DocumentEditorCanvas({
  path,
  updatedAt,
  truncated,
  loaded,
  editor,
  editable,
  focusTitle,
  onEditorReady,
  onLoaded,
  onEdit,
  onBlur,
  onRename,
  onOpenWikilink,
}: {
  path: string;
  updatedAt: string;
  truncated: boolean;
  loaded: NoteDraft['loaded'];
  editor: Editor | null;
  editable: boolean;
  focusTitle: boolean;
  onEditorReady: (editor: Editor | null) => void;
  onLoaded: (body: string) => void;
  onEdit: (body: string) => void;
  onBlur: () => void;
  onRename: (name: string) => Promise<void>;
  onOpenWikilink: (inner: string) => void;
}) {
  const t = useTranslations('documents');
  const relativeTime = useRelativeTime();
  const upload = useUploadNoteAsset(path);
  const imageInput = useRef<HTMLInputElement>(null);
  const images = useMemo(() => toEditorImages(loaded.body, path), [loaded, path]);
  const noteBody = useCallback(
    (markdown: string) => fromEditorImages(markdown, path, images.sources),
    [images, path],
  );

  const ready = useCallback(
    (instance: Editor | null) => {
      onEditorReady(instance);
      if (instance) onLoaded(noteBody(instance.storage.markdown.getMarkdown()));
    },
    [noteBody, onEditorReady, onLoaded],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {editable && (
        <div className="sticky top-0 z-10 border-b bg-background/92 px-3 py-1.5 backdrop-blur-xl supports-[backdrop-filter]:bg-background/78 md:px-5">
          <div className="mx-auto w-full max-w-[920px]">
            <DocumentToolbar editor={editor} onUploadImage={upload.mutateAsync} />
          </div>
        </div>
      )}
      <article className="mx-auto flex min-h-full w-full max-w-[860px] flex-col px-5 pt-10 pb-24 sm:px-8 md:pt-14 lg:px-14">
        {editable && (
          <input
            ref={imageInput}
            className="sr-only"
            type="file"
            accept="image/*"
            aria-label={t('toolbar.uploadImage')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              void upload
                .mutateAsync(file)
                .then((asset) => insertDocumentImage(editor, editable, asset.url, asset.filename))
                .catch(() => undefined);
            }}
          />
        )}
        <header className="mb-9 border-b border-border/55 pb-8">
          <DocumentPageTitle
            name={noteName(path)}
            editable={editable}
            autoFocus={focusTitle}
            onRename={onRename}
          />
          <p className="mt-3 text-xs text-muted-foreground/80">
            {truncated ? t('truncated') : t('updated', { time: relativeTime(updatedAt) })}
          </p>
        </header>
        <DocumentMarkdownEditor
          key={loaded.revision}
          defaultValue={images.markdown}
          editable={editable}
          placeholder={t('contentPlaceholder')}
          className="min-h-[58vh] flex-1 text-base leading-7"
          onReady={ready}
          onChange={(markdown) => onEdit(noteBody(markdown))}
          onBlur={onBlur}
          onOpenWikilink={onOpenWikilink}
          onPickImage={editable ? () => imageInput.current?.click() : undefined}
          onUploadImage={editable ? upload.mutateAsync : undefined}
        />
      </article>
    </div>
  );
}
