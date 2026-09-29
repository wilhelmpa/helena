import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import DocumentMarkdownEditor from '@/components/common/editor/DocumentMarkdownEditor';
import DocumentEditorField from '@/features/documents/components/DocumentEditorField';
import { useUploadNoteAsset } from '@/features/documents/services/knowledge.service';
import { useVaultWikilinkOpener } from '@/hooks/useVaultWikilinkOpener';
import { Segmented } from '@/design-system';
import { useVaultMarkdownSession } from '../hooks/useVaultMarkdownSession';
import VaultMarkdownBoundary from './VaultMarkdownBoundary';
import VaultMarkdownSource from './VaultMarkdownSource';

export default function VaultMarkdownContent({
  content,
  value,
  vaultPath,
  editable,
  onChange,
  beforeNavigate,
  sourceOnly = false,
}: {
  content: string;
  value: string;
  vaultPath: string;
  editable: boolean;
  onChange: (content: string) => void;
  beforeNavigate: () => boolean;
  sourceOnly?: boolean;
}) {
  const t = useTranslations('documents');
  const files = useTranslations('files.knowledge');
  const session = useVaultMarkdownSession({
    content,
    value,
    vaultPath,
    editable,
    onChange,
    initialMode: sourceOnly ? 'source' : 'formatted',
  });
  const { mode, lossless } = session;
  const [editor, setEditor] = useState<Editor | null>(null);
  const upload = useUploadNoteAsset(vaultPath);
  // What the formatted editor cannot keep exactly opens as source at once, editable
  // (owner 29.09., O79: text opens formatted; the source is the way back, never a dead view).
  useEffect(() => {
    if (lossless === false && mode === 'formatted') session.showSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the switch reacts to the check only
  }, [lossless, mode]);
  const openWikilink = useVaultWikilinkOpener(vaultPath, { beforeNavigate });
  const sourceEditor = (
    <VaultMarkdownSource value={value} editable={editable} onChange={onChange} />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {!sourceOnly && (
        <Segmented
          className="self-start"
          label={files('editor')}
          value={mode}
          onChange={(next) => (next === 'source' ? session.showSource() : session.showFormatted())}
          options={[
            { value: 'formatted', label: files('formatted') },
            { value: 'source', label: files('source') },
          ]}
        />
      )}
      {mode === 'source' ? (
        sourceEditor
      ) : (
        <VaultMarkdownBoundary
          key={session.revision}
          fallback={sourceEditor}
          onError={session.failClosed}
        >
          {editable ? (
            <DocumentEditorField editor={editor} onUploadImage={upload.mutateAsync}>
              <DocumentMarkdownEditor
                defaultValue={session.markdown}
                editable={editable && lossless === true}
                placeholder={t('contentPlaceholder')}
                className="ds-doc-editor-text flex-1 text-base leading-7"
                onReady={(instance) => {
                  setEditor(instance);
                  session.onReady(instance);
                }}
                onChange={session.onChange}
                onBlur={() => {}}
                onOpenWikilink={(inner) => void openWikilink(inner)}
              />
            </DocumentEditorField>
          ) : (
            <DocumentMarkdownEditor
              defaultValue={session.markdown}
              editable={editable && lossless === true}
              placeholder={t('contentPlaceholder')}
              className="ds-doc-editor-text flex-1 text-base leading-7"
              onReady={(instance) => {
                setEditor(instance);
                session.onReady(instance);
              }}
              onChange={session.onChange}
              onBlur={() => {}}
              onOpenWikilink={(inner) => void openWikilink(inner)}
            />
          )}
        </VaultMarkdownBoundary>
      )}
    </div>
  );
}
