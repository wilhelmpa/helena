import { vaultFileUrl } from '@/lib/api/endpoints/knowledge';
import { parentPath } from '@/utils/vaultLinks';

// A note links its images by vault path (`![](Assets/chart.png)`), which the browser
// cannot load. The editor gets them as vaultFileUrl()s instead, and a save writes each
// one back the way the file had it; an image added in the editor is written relative
// to the note.

// A src that starts with one of these is a path from the vault root, as Obsidian
// writes it with "Absolute path in vault".
const VAULT_FOLDERS = new Set(['Projects', 'Home', 'Templates', 'Private']);

const FENCE = /^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)?(`{3,}|~{3,})/;
const MARKDOWN_IMAGE =
  /(!\[(?:[^\]\\\n]|\\.)*\]\()(<[^>\n]*>|(?:[^\s()\\]|\\.)+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\))/g;
const HTML_IMAGE = /(<img\b[^>]*?\bsrc=")([^"]*)(")/gi;
const RAW_FILE = `${vaultFileUrl('x').split('?')[0]}?`;

type MapSource = (written: string, html: boolean) => string | null;

export type ImageSources = Map<string, { written: string; html: boolean }>;

function outsideCodeSpans(line: string, map: (text: string) => string): string {
  let out = '';
  let index = 0;
  while (index < line.length) {
    const open = line.indexOf('`', index);
    if (open === -1) break;
    let run = open;
    while (line[run] === '`') run += 1;
    const close = line.indexOf(line.slice(open, run), run);
    if (close === -1) break;
    out += map(line.slice(index, open)) + line.slice(open, close + run - open);
    index = close + run - open;
  }
  return out + map(line.slice(index));
}

// Calls `map` with the src of every image outside code, as written in the Markdown or
// in an <img> tag, and puts back what it returns (null keeps the src).
function mapImageSources(markdown: string, map: MapSource): string {
  const replace = (text: string) =>
    text
      .replace(MARKDOWN_IMAGE, (whole, head, src, tail) => {
        const next = map(src, false);
        return next === null ? whole : `${head}${next}${tail}`;
      })
      .replace(HTML_IMAGE, (whole, head, src, tail) => {
        const next = map(src, true);
        return next === null ? whole : `${head}${next}${tail}`;
      });
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const match = FENCE.exec(line);
      const marker = match?.[1];
      if (fence !== null) {
        const closes =
          marker !== undefined &&
          marker[0] === fence[0] &&
          marker.length >= fence.length &&
          !line.slice(match!.index + match![0].length).trim();
        if (closes) fence = null;
        return line;
      }
      if (marker !== undefined) {
        fence = marker;
        return line;
      }
      return outsideCodeSpans(line, replace);
    })
    .join('\n');
}

function markdownSource(written: string): string {
  const bare = written.startsWith('<') ? written.slice(1, -1) : written;
  return bare.replace(/\\(.)/g, '$1');
}

function htmlSource(written: string): string {
  return written
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

// The vault path an image src points to, or null for a URL, a web path, or a path
// that leaves the vault.
export function resolveImagePath(notePath: string, src: string): string | null {
  if (!src || src.startsWith('/') || src.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURI(src);
  } catch {
    return null;
  }
  const segments = decoded.split('/');
  const parts = VAULT_FOLDERS.has(segments[0]!) ? [] : parentPath(notePath).split('/');
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment !== '..') parts.push(segment);
    else if (parts.pop() === undefined) return null;
  }
  return parts.filter(Boolean).join('/') || null;
}

export function relativeImagePath(notePath: string, path: string): string {
  const from = parentPath(notePath).split('/').filter(Boolean);
  const to = path.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) {
    common += 1;
  }
  const relative = [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/');
  return relative.replace(/[%\s()<>]/g, (character) =>
    encodeURIComponent(character) === character
      ? `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      : encodeURIComponent(character),
  );
}

function vaultPathOfUrl(src: string): string | null {
  if (!src.startsWith(RAW_FILE)) return null;
  const path = new URLSearchParams(src.slice(RAW_FILE.length)).get('path');
  return path && vaultFileUrl(path) === src ? path : null;
}

export function toEditorImages(
  markdown: string,
  notePath: string,
): { markdown: string; sources: ImageSources } {
  const sources: ImageSources = new Map();
  const mapped = mapImageSources(markdown, (written, html) => {
    const path = resolveImagePath(notePath, html ? htmlSource(written) : markdownSource(written));
    if (!path) return null;
    const url = vaultFileUrl(path);
    if (!sources.has(url)) sources.set(url, { written, html });
    return url;
  });
  return { markdown: mapped, sources };
}

export function fromEditorImages(markdown: string, notePath: string, sources: ImageSources) {
  return mapImageSources(markdown, (written, html) => {
    const src = html ? htmlSource(written) : markdownSource(written);
    const path = vaultPathOfUrl(src);
    if (!path) return null;
    const original = sources.get(src);
    return original?.html === html ? original.written : relativeImagePath(notePath, path);
  });
}
