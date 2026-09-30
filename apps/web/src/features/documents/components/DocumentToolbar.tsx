'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  CheckSquare2,
  Code,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import DocumentBlockTypeMenu from './DocumentBlockTypeMenu';
import DocumentImageMenu from './DocumentImageMenu';
import DocumentToolbarButton from './DocumentToolbarButton';

export default function DocumentToolbar({
  editor,
  onUploadImage,
  wrap = false,
}: {
  editor: Editor | null;
  // Without it (an agent's instructions, no vault to store an image in) the image button is left out.
  onUploadImage?: (file: File) => Promise<{ url: string; filename: string }>;
  // In a narrow overlay the buttons wrap onto a second row instead of scrolling out of sight.
  wrap?: boolean;
}) {
  const t = useTranslations('documents.toolbar');
  const [, renderSelection] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => renderSelection((revision) => revision + 1);
    editor.on('transaction', refresh);
    editor.on('selectionUpdate', refresh);
    return () => {
      editor.off('transaction', refresh);
      editor.off('selectionUpdate', refresh);
    };
  }, [editor]);

  if (!editor) {
    return (
      <div className="flex h-12 items-center gap-2 px-3 md:px-4" aria-hidden>
        <div className="h-8 w-28 animate-pulse rounded-md bg-muted/60" />
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted/40" />
      </div>
    );
  }

  const textActions = [
    {
      label: t('bold'),
      active: editor.isActive('bold'),
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: t('italic'),
      active: editor.isActive('italic'),
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: t('underline'),
      active: editor.isActive('underline'),
      icon: Underline,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: t('strike'),
      active: editor.isActive('strike'),
      icon: Strikethrough,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: t('inlineCode'),
      active: editor.isActive('code'),
      icon: Code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
  ];

  const blockActions = [
    {
      label: t('bulletList'),
      active: editor.isActive('bulletList'),
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: t('numberedList'),
      active: editor.isActive('orderedList'),
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: t('todoList'),
      active: editor.isActive('taskList'),
      icon: CheckSquare2,
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: t('quote'),
      active: editor.isActive('blockquote'),
      icon: Quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: t('codeBlock'),
      active: editor.isActive('codeBlock'),
      icon: SquareCode,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];

  return (
    <div
      className={
        wrap
          ? 'ds-doc-toolbar-wrap'
          : 'flex h-12 min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto px-3 md:px-4 [&::-webkit-scrollbar]:hidden'
      }
      role="toolbar"
      aria-label={t('label')}
    >
      <div className="me-1 flex shrink-0 items-center border-e pe-2">
        <DocumentBlockTypeMenu editor={editor} />
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {textActions.map((action) => (
          <DocumentToolbarButton
            key={action.label}
            label={action.label}
            active={action.active}
            onPress={action.run}
          >
            <action.icon />
          </DocumentToolbarButton>
        ))}
      </div>

      <div className="mx-1 flex shrink-0 items-center gap-0.5 border-s ps-2">
        {blockActions.map((action) => (
          <DocumentToolbarButton
            key={action.label}
            label={action.label}
            active={action.active}
            onPress={action.run}
          >
            <action.icon />
          </DocumentToolbarButton>
        ))}
        <DocumentToolbarButton
          label={t('divider')}
          onPress={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus />
        </DocumentToolbarButton>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <DocumentToolbarButton
          label={t('table')}
          active={editor.isActive('table')}
          onPress={() => {
            if (editor.isActive('table')) editor.chain().focus().deleteTable().run();
            else
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          }}
        >
          <Table2 />
        </DocumentToolbarButton>
        {onUploadImage && <DocumentImageMenu editor={editor} onUpload={onUploadImage} />}
      </div>

      <div className="ms-auto flex shrink-0 items-center gap-0.5 border-s ps-2">
        <DocumentToolbarButton
          label={t('undo')}
          disabled={!editor.can().chain().focus().undo().run()}
          onPress={() => editor.chain().focus().undo().run()}
        >
          <Undo2 />
        </DocumentToolbarButton>
        <DocumentToolbarButton
          label={t('redo')}
          disabled={!editor.can().chain().focus().redo().run()}
          onPress={() => editor.chain().focus().redo().run()}
        >
          <Redo2 />
        </DocumentToolbarButton>
      </div>
    </div>
  );
}
