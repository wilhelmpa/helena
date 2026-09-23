import { isDeepStrictEqual } from 'node:util';
import { parseDocument, stringify } from 'yaml';
import type { VaultLinkKind } from '@repo/db';
import { baseName, joinVaultPath, normalizeVaultPath, parentPath } from './paths';

export type Frontmatter = Record<string, unknown>;

export interface NoteParts {
  // The YAML between the fences, exactly as written; null without a frontmatter block.
  frontmatterRaw: string | null;
  frontmatter: Frontmatter;
  body: string;
}

const FRONTMATTER = /^\uFEFF?---\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

function isPlainObject(value: unknown): value is Frontmatter {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Invalid YAML reads as an empty frontmatter, the way Obsidian shows it: the block is
// kept in the file and in the raw text, it just contributes no properties.
export function parseFrontmatter(raw: string): Frontmatter {
  const document = parseDocument(raw);
  if (document.errors.length > 0) return {};
  const value: unknown = document.toJS();
  return isPlainObject(value) ? value : {};
}

export function splitNote(content: string): NoteParts {
  const match = FRONTMATTER.exec(content);
  if (!match) return { frontmatterRaw: null, frontmatter: {}, body: content };
  const raw = match[1] ?? '';
  return {
    frontmatterRaw: raw,
    frontmatter: parseFrontmatter(raw),
    body: content.slice(match[0].length),
  };
}

// Joins a body and its frontmatter into the file's text. Keys the caller did not change
// keep their original formatting and comments: an unchanged frontmatter is written back
// verbatim, a changed one is edited in place in the parsed YAML document.
export function composeNote(
  frontmatter: Frontmatter,
  body: string,
  originalRaw: string | null,
): string {
  if (Object.keys(frontmatter).length === 0) return body;
  let yaml: string;
  if (originalRaw !== null && isDeepStrictEqual(parseFrontmatter(originalRaw), frontmatter)) {
    yaml = originalRaw;
  } else if (originalRaw !== null && parseDocument(originalRaw).errors.length === 0) {
    const document = parseDocument(originalRaw);
    const previous = parseFrontmatter(originalRaw);
    for (const key of Object.keys(previous)) {
      if (!(key in frontmatter)) document.delete(key);
    }
    for (const [key, value] of Object.entries(frontmatter)) {
      if (!isDeepStrictEqual(previous[key], value)) document.set(key, value);
    }
    yaml = document.toString({ flowCollectionPadding: false, lineWidth: 0 }).trimEnd();
  } else {
    yaml = stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  }
  return `---\n${yaml}\n---\n${body}`;
}

// The name a note is listed and linked under: its frontmatter title, else its file
// name without ".md", which is what Obsidian shows.
export function noteTitle(frontmatter: Frontmatter, relative: string): string {
  const title = frontmatter.title;
  if (typeof title === 'string' && title.trim()) return title.trim();
  return baseName(relative).replace(/\.md$/i, '');
}

export function frontmatterTags(frontmatter: Frontmatter): string[] {
  const tags = frontmatter.tags;
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,\s]+/) : [];
  return list
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean);
}

export interface NoteLink {
  kind: VaultLinkKind;
  target: string;
}

// A task identifier as the tracker issues them: the project key, a dash, the number.
// The key has to start with a letter, so a date such as [[2026-09-23]] stays a note link.
export const TASK_IDENTIFIER = /^[A-Z][A-Z0-9_]*(?:-[A-Z0-9_]+)*-\d{1,9}$/;

const WIKILINK = /!?\[\[([^[\]\n]+?)\]\]/g;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const BARE_URL = /https?:\/\/[^\s<>()[\]"'`]+/g;

// Code is not prose: a [[link]] inside a fenced block or an inline span is an example.
function withoutCode(text: string): string {
  return text.replace(/(^|\n)(```|~~~)[\s\S]*?(\n\2[^\n]*|$)/g, '$1').replace(/`[^`\n]*`/g, '');
}

function wikiTarget(inner: string): string {
  const target = inner.split('|')[0].split('#')[0].trim();
  return target.replace(/\.md$/i, '');
}

function relativeLinkTarget(href: string, notePath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURI(href.split('#')[0]);
  } catch {
    return null;
  }
  if (!decoded || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;
  const parts: string[] = decoded.startsWith('/') ? [] : parentPath(notePath).split('/');
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  try {
    return normalizeVaultPath(joinVaultPath(...parts)).replace(/\.md$/i, '') || null;
  } catch {
    return null;
  }
}

// The links a note makes: wikilinks (a task identifier becomes a task link), relative
// Markdown links to other vault files, and http(s) URLs.
export function extractLinks(content: string, notePath: string): NoteLink[] {
  const text = withoutCode(content);
  const found = new Map<string, NoteLink>();
  const add = (kind: VaultLinkKind, target: string) => {
    if (target) found.set(`${kind}\u0000${target}`, { kind, target });
  };
  for (const match of text.matchAll(WIKILINK)) {
    const target = wikiTarget(match[1]);
    add(TASK_IDENTIFIER.test(target) ? 'task' : 'note', target);
  }
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const href = match[1];
    if (/^https?:\/\//i.test(href)) continue;
    const target = relativeLinkTarget(href, notePath);
    if (target) add('note', target);
  }
  for (const match of text.matchAll(BARE_URL)) add('url', match[0].replace(/[.,;:!?]+$/, ''));
  return [...found.values()];
}
