// Obsidian wikilinks: [[Note]], [[Folder/Note|Alias]], [[Note#Heading]], and [[VOL-12]]
// for a task. The text between the brackets is kept as written, so a link saves back
// exactly as it was read.

// The same rule as the vault indexer: the project key starts with a letter, so a date
// such as [[2026-09-23]] stays a note link.
const TASK_IDENTIFIER = /^[A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)*-\d{1,9}$/;

// Typing the closing brackets turns the link into a wikilink node.
export const WIKILINK_INPUT = /\[\[([^[\]\n]+)\]\]$/;

export interface Wikilink {
  target: string;
  heading: string | null;
  alias: string | null;
}

export function parseWikilink(inner: string): Wikilink {
  const bar = inner.indexOf('|');
  // In a table Obsidian writes the alias bar as "\|".
  const link = bar === -1 ? inner : inner.slice(0, bar).replace(/\\$/, '');
  const hash = link.indexOf('#');
  return {
    target: (hash === -1 ? link : link.slice(0, hash)).trim(),
    heading: hash === -1 ? null : link.slice(hash + 1).trim() || null,
    alias: bar === -1 ? null : inner.slice(bar + 1).trim() || null,
  };
}

export function wikilinkLabel(inner: string): string {
  const { target, heading, alias } = parseWikilink(inner);
  return alias ?? [target, heading].filter(Boolean).join(' › ');
}

// The task identifier a link points to, or null for a note link.
export function wikilinkTask(inner: string): string | null {
  const { target } = parseWikilink(inner);
  return TASK_IDENTIFIER.test(target) ? target : null;
}

export const wikilinkMarkdown = (inner: string) => `[[${inner}]]`;

// The wikilink that starts at `start` in a line of Markdown: its inner text and the
// index after the closing brackets. The inner text holds no brackets and no line break.
export function scanWikilink(src: string, start: number): { inner: string; end: number } | null {
  if (!src.startsWith('[[', start)) return null;
  const close = src.indexOf(']]', start + 2);
  if (close === -1) return null;
  const inner = src.slice(start + 2, close);
  if (!inner.trim() || /[[\]\n]/.test(inner)) return null;
  return { inner, end: close + 2 };
}
