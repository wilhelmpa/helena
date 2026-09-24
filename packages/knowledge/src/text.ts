import { createHash } from 'node:crypto';
import type { KnowledgeLink } from '@helena/sdk';

// The stored text of an item is capped; the search vector reads its first 100,000
// characters (see knowledge_item), the rest is kept for reading and for passages.
export const MAX_ITEM_TEXT = 200_000;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function capText(text: string, max = MAX_ITEM_TEXT): string {
  return text.length > max ? text.slice(0, max) : text;
}

// A task identifier as the tracker issues it (`VOL-12`) written anywhere in a text. The
// key starts with a letter and has at least two characters, so `A-1` or a date is not
// one; a few common non-task words of the same shape are left out.
const TASK_MENTION = /(?<![\w/-])([A-Z][A-Z0-9_]{1,15}-\d{1,9})(?![\w-])/g;
const NOT_TASKS = new Set(['UTF', 'ISO', 'COVID', 'SHA', 'MD', 'RFC', 'CVE', 'DIN', 'EN']);

export function taskMentions(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(TASK_MENTION)) {
    const identifier = match[1];
    if (NOT_TASKS.has(identifier.slice(0, identifier.lastIndexOf('-')))) continue;
    found.add(identifier);
  }
  return [...found];
}

// The canonical link targets the index stores (see knowledge_link):
// - `task:<IDENTIFIER>`: a task as people write it, `task:VOL-12`;
// - `vault:<path>`: a note or file of the vault;
// - `<source>:<id>`: any other item;
// - an http(s) URL as is.
export const taskTarget = (identifier: string) => `task:${identifier.toUpperCase()}`;
export const vaultTarget = (relative: string) => `vault:${relative}`;
export const itemRef = (source: string, id: string) => `${source}:${id}`;

export function parseRef(ref: string): { source: string; id: string } | null {
  const colon = ref.indexOf(':');
  if (colon <= 0 || colon === ref.length - 1) return null;
  return { source: ref.slice(0, colon), id: ref.slice(colon + 1) };
}

export function mentionLinks(text: string): KnowledgeLink[] {
  return taskMentions(text).map((identifier) => ({
    target: taskTarget(identifier),
    kind: 'mentions' as const,
  }));
}

// Markdown to the words a reader sees, for excerpts: no image or link targets, no
// emphasis marks, no HTML tags. Not a renderer, just enough for a snippet.
export function plainText(markdown: string): string {
  return markdown
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/!\[\[[^\]\n]*\]\]/g, ' ')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ')
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2')
    .replace(/\[\[([^\]\n]+)\]\]/g, '$1')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/[*_~`>#]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
