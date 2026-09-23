import HardBreak from '@tiptap/extension-hard-break';

// A line break inside a paragraph, saved as a plain newline. The editor reads Markdown
// with `breaks: true`, the way Obsidian shows it, so a single newline comes back as the
// same break; tiptap-markdown's default "\" + newline would rewrite every such line of
// a note written in Obsidian on its first save. Inside a table cell, where a newline
// would end the row, it stays <br>.
export const SoftLineBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (text: string) => void; inTable?: boolean },
          node: { type: unknown },
          parent: { childCount: number; child: (index: number) => { type: unknown } },
          index: number,
        ) {
          for (let next = index + 1; next < parent.childCount; next += 1) {
            if (parent.child(next).type !== node.type) {
              state.write(state.inTable ? '<br>' : '\n');
              return;
            }
          }
        },
        parse: {},
      },
    };
  },
});
