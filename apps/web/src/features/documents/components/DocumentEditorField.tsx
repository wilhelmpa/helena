'use client';

import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import DocumentToolbar from './DocumentToolbar';

// The Markdown editor of Wissen as one visible field (owner 29.09., O79): the toolbar on
// top, the text under it, on one surface. The same for a doc, a plain text file and any
// other Markdown the formatted editor shows — where the editor is used, its field looks the
// same. `children` is the editor's content.
export default function DocumentEditorField({
  editor,
  onUploadImage,
  children,
}: {
  editor: Editor | null;
  onUploadImage: (file: File) => Promise<{ url: string; filename: string }>;
  children: ReactNode;
}) {
  return (
    <div className="ds-doc-editor">
      <div className="ds-doc-editor-bar">
        <DocumentToolbar editor={editor} onUploadImage={onUploadImage} wrap />
      </div>
      <div className="ds-doc-editor-body">{children}</div>
    </div>
  );
}
