// Keep the original metadata bytes outside the rich-text editor.
const FRONTMATTER = /^\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function markdownContent(content: string) {
  const prefix = FRONTMATTER.exec(content)?.[0] ?? '';
  return { prefix, body: content.slice(prefix.length) };
}

export function preserveMarkdownEnding(original: string, serialized: string): string {
  return serialized.replace(/\n+$/, '') + (original.match(/\n*$/)?.[0] ?? '');
}
