import { Defuddle } from 'defuddle/node';
import { parseHTML } from 'linkedom';

// A web page as a note: the readable part of the page as Markdown, with its title and
// metadata, the way Obsidian's Web Clipper does it (Defuddle on a linkedom document,
// turndown for the Markdown). No browser and no network here: the caller hands over the
// page's HTML, taken from the project browser or fetched once server-side.

export interface WebPageNote {
  title: string;
  markdown: string;
  author: string | null;
  published: string | null;
  description: string | null;
  site: string | null;
}

const MAX_HTML = 5 * 1024 * 1024;

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function webPageToNote(html: string, url: string): Promise<WebPageNote> {
  const { document } = parseHTML(html.slice(0, MAX_HTML));
  const result = await Defuddle(document as unknown as Parameters<typeof Defuddle>[0], url, {
    markdown: true,
  });
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    host = null;
  }
  return {
    title: clean(result.title) ?? host ?? url,
    markdown: (result.content ?? '').trim(),
    author: clean(result.author),
    published: clean(result.published),
    description: clean(result.description),
    site: clean(result.site) ?? host,
  };
}

// The note's text: the page's description as a quote, then its content, then where it
// came from.
export function webNoteText(page: WebPageNote, url: string): string {
  const parts: string[] = [];
  if (page.description) parts.push(`> ${page.description.replace(/\n+/g, ' ')}`);
  if (page.markdown) parts.push(page.markdown);
  const byline = [page.author, page.site, page.published].filter(Boolean).join(' · ');
  parts.push(`---\n${byline ? `${byline} · ` : ''}[${url}](${url})`);
  return parts.join('\n\n');
}
