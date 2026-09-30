import { useMemo, useState } from 'react';
import { type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Check,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { normalizeUrl } from '@/utils/url';
import EditorToolbarButton from './EditorToolbarButton';

type SelectionItem = {
  // With `attrs`, the mark or node the button toggles, which is also what lights it up.
  name: string;
  attrs?: { level: 1 | 2 };
  // Its name under common.editor.format, for the tooltip and screen readers.
  label:
    | 'heading1'
    | 'heading2'
    | 'bold'
    | 'italic'
    | 'strike'
    | 'code'
    | 'codeBlock'
    | 'link'
    | 'blockquote'
    | 'bulletList'
    | 'orderedList';
  icon: LucideIcon;
  run?: (editor: Editor) => void;
};

const ITEMS: SelectionItem[] = [
  {
    name: 'heading',
    attrs: { level: 1 },
    label: 'heading1',
    icon: Heading1,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    name: 'heading',
    attrs: { level: 2 },
    label: 'heading2',
    icon: Heading2,
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    name: 'bold',
    label: 'bold',
    icon: Bold,
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    name: 'italic',
    label: 'italic',
    icon: Italic,
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    name: 'strike',
    label: 'strike',
    icon: Strikethrough,
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    name: 'code',
    label: 'code',
    icon: Code,
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    name: 'codeBlock',
    label: 'codeBlock',
    icon: SquareCode,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  // The link opens the address field in the menu itself (below), not a browser prompt.
  { name: 'link', label: 'link', icon: LinkIcon },
  {
    name: 'blockquote',
    label: 'blockquote',
    icon: Quote,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    name: 'bulletList',
    label: 'bulletList',
    icon: List,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    name: 'orderedList',
    label: 'orderedList',
    icon: ListOrdered,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
];

export default function EditorSelectionMenu({
  editor,
  placement = 'top',
}: {
  editor: Editor;
  // Above the selection by default. A field with a label right over it passes
  // "bottom" so the menu does not cover the label.
  placement?: 'top' | 'bottom';
}) {
  const t = useTranslations('common.editor');
  // The link's address while it is being written; null shows the format buttons.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  function openLink() {
    setLinkDraft((editor.getAttributes('link').href as string | undefined) ?? '');
  }

  function applyLink() {
    const url = normalizeUrl(linkDraft ?? '');
    const chain = editor.chain().focus().extendMarkRange('link');
    if (url) chain.setLink({ href: url }).run();
    else chain.unsetLink().run();
    setLinkDraft(null);
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkDraft(null);
  }

  // Stable: a new `options` object at every render re-registers the menu's plugin, which is one
  // more editor transaction, which renders again (O97, see EditorTableMenu).
  const options = useMemo(() => ({ placement, onHide: () => setLinkDraft(null) }), [placement]);

  return (
    <BubbleMenu
      editor={editor}
      options={options}
      className="flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md"
    >
      {linkDraft !== null ? (
        <form
          className="flex items-center gap-0.5"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <input
            // The field is what the link button opened; typing goes straight into it.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            type="text"
            inputMode="url"
            value={linkDraft}
            placeholder="https://…"
            aria-label={t('linkUrl')}
            className="h-7 w-56 rounded-sm bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              setLinkDraft(null);
              editor.commands.focus();
            }}
          />
          <EditorToolbarButton title={t('linkApply')} onClick={applyLink}>
            <Check />
          </EditorToolbarButton>
          {editor.isActive('link') && (
            <EditorToolbarButton title={t('linkRemove')} onClick={removeLink}>
              <Unlink />
            </EditorToolbarButton>
          )}
        </form>
      ) : (
        ITEMS.map((item) => (
          <EditorToolbarButton
            key={`${item.name}${item.attrs?.level ?? ''}`}
            title={t(`format.${item.label}`)}
            active={editor.isActive(item.name, item.attrs)}
            onClick={() => (item.run ? item.run(editor) : openLink())}
          >
            <item.icon />
          </EditorToolbarButton>
        ))
      )}
    </BubbleMenu>
  );
}
