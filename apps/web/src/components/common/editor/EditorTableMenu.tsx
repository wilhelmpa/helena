import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { BetweenHorizontalEnd, BetweenVerticalEnd, Columns3, Rows3, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import EditorToolbarButton from './EditorToolbarButton';

const ITEMS = [
  {
    label: 'tableAddRow',
    icon: BetweenHorizontalEnd,
    run: (editor: Editor) => editor.chain().focus().addRowAfter().run(),
  },
  {
    label: 'tableDeleteRow',
    icon: Rows3,
    run: (editor: Editor) => editor.chain().focus().deleteRow().run(),
  },
  {
    label: 'tableAddColumn',
    icon: BetweenVerticalEnd,
    run: (editor: Editor) => editor.chain().focus().addColumnAfter().run(),
  },
  {
    label: 'tableDeleteColumn',
    icon: Columns3,
    run: (editor: Editor) => editor.chain().focus().deleteColumn().run(),
  },
  {
    label: 'tableDelete',
    icon: Trash2,
    run: (editor: Editor) => editor.chain().focus().deleteTable().run(),
  },
] as const;

// Row and column commands for the table the cursor sits in. Shown only while
// nothing is selected: a selection inside a cell belongs to EditorSelectionMenu,
// which formats the text, and two bubble menus over one selection would overlap.
// The bubble menu re-registers its plugin (one more editor transaction) whenever the `options`
// or `shouldShow` it is given change identity. Given fresh ones at every render, a transaction
// renders the editor, the render changes them, and that is the next transaction: an endless
// exchange that React stops with "Maximum update depth exceeded" once many keystrokes arrive in
// one go (O97). Both are therefore constants.
const OPTIONS = { placement: 'top' } as const;
const inTable = ({ editor, state }: { editor: Editor; state: { selection: { empty: boolean } } }) =>
  state.selection.empty && editor.isActive('table');

export default function EditorTableMenu({ editor }: { editor: Editor }) {
  const t = useTranslations('common.editor');
  return (
    <BubbleMenu
      editor={editor}
      options={OPTIONS}
      shouldShow={inTable}
      className="flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md"
    >
      {ITEMS.map((item) => (
        <EditorToolbarButton
          key={item.label}
          title={t(item.label)}
          onClick={() => item.run(editor)}
        >
          <item.icon />
        </EditorToolbarButton>
      ))}
    </BubbleMenu>
  );
}
