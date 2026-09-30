'use client';

import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { Segmented, Stack, Text, TextArea } from '@/design-system';
import DocumentMarkdownEditor from '@/components/common/editor/DocumentMarkdownEditor';
import DocumentEditorField from '@/features/documents/components/DocumentEditorField';
import { preserveMarkdownEnding } from '@/utils/markdownEnding';
import { equivalentMarkdown } from './markdownEquivalence';

// The Markdown editor of Wissen as one field for any Markdown text that is not a vault file:
// an agent's instructions, its SOUL, a memory file. The same toolbar and surface as the
// Wissen editor (DocumentEditorField), with the switch "Formatiert | Quelltext" above it. A
// text the formatted editor cannot write back unchanged opens as source, so opening a file
// never rewrites it.
export default function MarkdownField({
  value,
  onChange,
  label,
  placeholder,
  editable = true,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  // Names the editing area (a contenteditable has no <label>).
  label: string;
  placeholder?: string;
  editable?: boolean;
  className?: string;
}) {
  const t = useTranslations('agentPages.editor');
  const [mode, setMode] = useState<'formatted' | 'source'>('formatted');
  // The editor reads its content once, so it remounts when the text comes from the other mode.
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState(false);
  const baseline = useRef(value);

  const showSource = (lossy: boolean) => {
    setNotice(lossy);
    setMode('source');
  };

  return (
    <Stack gap={2} className={className}>
      <Segmented
        className="ds-markdown-field-switch"
        label={t('label')}
        value={mode}
        onChange={(next) => {
          if (next === 'source') showSource(false);
          else {
            baseline.current = value;
            setNotice(false);
            setRevision((current) => current + 1);
            setMode('formatted');
          }
        }}
        options={[
          { value: 'formatted', label: t('formatted') },
          { value: 'source', label: t('source') },
        ]}
      />
      {mode === 'source' ? (
        <>
          <TextArea
            className="ds-markdown-field-source"
            aria-label={label}
            value={value}
            readOnly={!editable}
            placeholder={placeholder}
            dir="auto"
            onChange={(event) => onChange(event.target.value)}
          />
          {notice && (
            <Text size="xs" tone="muted">
              {t('lossy')}
            </Text>
          )}
        </>
      ) : (
        <DocumentEditorField editor={editor} showToolbar={editable}>
          <DocumentMarkdownEditor
            key={revision}
            defaultValue={value}
            editable={editable}
            placeholder={placeholder ?? ''}
            className="ds-doc-editor-text ds-markdown-field-text flex-1"
            onReady={(instance) => {
              setEditor(instance);
              if (!instance) return;
              // A text the editor would write back differently is left as source.
              if (!equivalentMarkdown(baseline.current, instance.storage.markdown.getMarkdown())) {
                showSource(true);
              }
            }}
            onChange={(markdown) => {
              if (editable) onChange(preserveMarkdownEnding(baseline.current, markdown));
            }}
            onBlur={() => {}}
          />
        </DocumentEditorField>
      )}
    </Stack>
  );
}
