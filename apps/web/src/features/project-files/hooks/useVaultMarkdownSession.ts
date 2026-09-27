import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { fromEditorImages, toEditorImages } from '@/utils/vaultImages';
import { restoreWikilinkTablePipes } from '@/utils/wikilinkTablePipes';
import { markdownContent, preserveMarkdownEnding } from '../utils/markdownContent';

export function useVaultMarkdownSession({
  content,
  value,
  vaultPath,
  editable,
  onChange,
  initialMode = 'formatted',
}: {
  content: string;
  value: string;
  vaultPath: string;
  editable: boolean;
  onChange: (value: string) => void;
  initialMode?: 'formatted' | 'source';
}) {
  const [mode, setMode] = useState<'formatted' | 'source'>(initialMode);
  const [snapshot, setSnapshot] = useState({ content, revision: 0 });
  const [check, setCheck] = useState<{
    snapshot: typeof snapshot;
    vaultPath: string;
    lossless: boolean;
  } | null>(null);
  const lossless =
    check?.snapshot === snapshot && check.vaultPath === vaultPath ? check.lossless : null;
  const original = useMemo(() => markdownContent(snapshot.content), [snapshot]);
  const images = useMemo(() => toEditorImages(original.body, vaultPath), [original, vaultPath]);
  const baseline = useRef<string | null>(null);
  const active = useRef<{ snapshot: typeof snapshot; vaultPath: string; editable: boolean } | null>(
    null,
  );
  useLayoutEffect(() => {
    active.current = mode === 'formatted' ? { snapshot, vaultPath, editable } : null;
    return () => {
      active.current = null;
    };
  }, [mode, snapshot, vaultPath, editable]);
  const isCurrent = () =>
    active.current?.snapshot === snapshot && active.current.vaultPath === vaultPath;
  const bodyOf = (markdown: string) =>
    restoreWikilinkTablePipes(original.body, fromEditorImages(markdown, vaultPath, images.sources));
  const failClosed = () => {
    active.current = null;
    setCheck({ snapshot, vaultPath, lossless: false });
    setMode('source');
  };
  return {
    mode,
    lossless,
    markdown: images.markdown,
    revision: snapshot.revision,
    failClosed,
    showSource: () => {
      active.current = null;
      setMode('source');
    },
    showFormatted: () => {
      if (mode === 'formatted') return;
      active.current = null;
      setSnapshot((current) => ({ content: value, revision: current.revision + 1 }));
      setCheck(null);
      setMode('formatted');
    },
    onReady: (editor: Editor | null) => {
      if (!editor || !isCurrent()) return;
      try {
        const body = bodyOf(editor.storage.markdown.getMarkdown());
        const preserved = preserveMarkdownEnding(original.body, body) === original.body;
        baseline.current = body;
        setCheck({ snapshot, vaultPath, lossless: preserved });
      } catch {
        failClosed();
      }
    },
    onChange: (markdown: string) => {
      if (
        !editable ||
        !active.current?.editable ||
        lossless !== true ||
        baseline.current === null ||
        !isCurrent()
      )
        return;
      try {
        const body = bodyOf(markdown);
        onChange(
          body === baseline.current
            ? snapshot.content
            : original.prefix + preserveMarkdownEnding(original.body, body),
        );
      } catch {
        failClosed();
      }
    },
  };
}
