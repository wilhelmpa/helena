import { InputRule, mergeAttributes, Node } from '@tiptap/core';
import {
  scanWikilink,
  WIKILINK_INPUT,
  wikilinkLabel,
  wikilinkMarkdown,
  wikilinkTask,
} from '@/utils/wikilink';

// The parts of markdown-it this extension uses; tiptap-markdown hands over its instance.
interface InlineState {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: number) => { content: string };
}
interface MarkdownIt {
  inline: {
    ruler: {
      before: (
        name: string,
        rule: string,
        fn: (state: InlineState, silent: boolean) => boolean,
      ) => void;
    };
  };
  renderer: { rules: Record<string, (tokens: { content: string }[], index: number) => string> };
  utils: { escapeHtml: (text: string) => string };
}

// tiptap-markdown runs `setup` before every parse, on the same markdown-it instance.
const prepared = new WeakSet<MarkdownIt>();

function wikilinkRule(state: InlineState, silent: boolean): boolean {
  const found = scanWikilink(state.src, state.pos);
  if (!found || found.end > state.posMax) return false;
  if (!silent) state.push('wikilink', '', 0).content = found.inner;
  state.pos = found.end;
  return true;
}

const NOTE_CLASS =
  'cursor-pointer text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary';
const TASK_CLASS =
  'cursor-pointer rounded-md border bg-muted px-1.5 py-0.5 font-mono wikilink-chip hover:bg-accent';

// A wikilink as one inline unit. It keeps the text between the brackets as written,
// so it saves back unchanged. The markdown-it rule runs before the link rule; the
// code rules run before both, so a link in code stays text.
export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      inner: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-wikilink') ?? '',
        renderHTML: (attributes) => ({ 'data-wikilink': attributes.inner }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const inner = String(node.attrs.inner);
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        role: 'link',
        class: wikilinkTask(inner) ? TASK_CLASS : NOTE_CLASS,
        dir: 'auto',
      }),
      wikilinkLabel(inner),
    ];
  },

  renderText({ node }) {
    return wikilinkMarkdown(String(node.attrs.inner));
  },

  addInputRules() {
    return [
      new InputRule({
        find: WIKILINK_INPUT,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ inner: match[1] }));
        },
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void }, node: { attrs: { inner: string } }) {
          state.write(wikilinkMarkdown(node.attrs.inner));
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            if (prepared.has(markdownit)) return;
            prepared.add(markdownit);
            markdownit.inline.ruler.before('link', 'wikilink', wikilinkRule);
            markdownit.renderer.rules.wikilink = (tokens, index) =>
              `<span data-wikilink="${markdownit.utils.escapeHtml(tokens[index]!.content)}"></span>`;
          },
        },
      },
    };
  },
});
