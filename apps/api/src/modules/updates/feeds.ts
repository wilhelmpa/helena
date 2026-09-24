import { compareVersions, isPrerelease } from '@helena/sdk';

// Readers for the published data the update sources look at: a GitHub releases Atom feed,
// a CHANGELOG.md with one heading per version, a Debian changelog. Regular expressions
// rather than an XML dependency: the shapes are fixed (settings/updates.ts reads the same
// feed the same way).

// Release notes handed to the summary are cut here, newest first: enough for a small model
// to rate the change, bounded in tokens.
export const NOTES_MAX_CHARS = 12_000;

export interface FeedEntry {
  title: string;
  // The tag of the release page (`rust-v0.158.0`), and the version in it (`0.158.0`).
  tag: string | null;
  version: string | null;
  url: string | null;
  updated: string | null;
  // The notes as plain text.
  text: string;
}

// '&amp;' last, so a double-escaped sequence does not decode twice.
export function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

// HTML release notes as text: list items as "- ", headings and paragraphs on lines of their
// own, every other tag dropped.
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<h[1-6][^>]*>/gi, '\n\n## ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|ul|ol|h[1-6]|pre|table|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The version a tag or title names: the last `1.2.3`-like part (`rust-v0.158.0-alpha.9`,
// `bun-v1.4.3`, `Hermes Agent v0.21.5 (v2026.9.24)` → the first).
export function versionIn(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /(?:^|[^0-9A-Za-z.])v?(\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)/.exec(
    value,
  );
  return match ? match[1]!.replace(/[.-]+$/, '') : null;
}

export function parseAtom(xml: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/.exec(entry!)?.[1] ?? '').trim();
    const link = /<link[^>]*href="([^"]+)"/.exec(entry!)?.[1] ?? null;
    const url = link ? decodeEntities(link) : null;
    const tagMatch = url ? /\/releases\/tag\/([^/?#]+)/.exec(url) : null;
    const tag = tagMatch ? decodeURIComponent(tagMatch[1]!) : null;
    const content = /<content[^>]*>([\s\S]*?)<\/content>/.exec(entry!)?.[1] ?? '';
    entries.push({
      title,
      tag,
      version: versionIn(tag) ?? versionIn(title),
      url,
      updated: /<updated>([^<]+)<\/updated>/.exec(entry!)?.[1] ?? null,
      text: htmlToText(decodeEntities(content)),
    });
  }
  return entries;
}

// The newest release of a feed that is not a prerelease, or null.
export function newestRelease(entries: FeedEntry[]): FeedEntry | null {
  let best: FeedEntry | null = null;
  for (const entry of entries) {
    if (!entry.version || isPrerelease(entry.version)) continue;
    if (!best || (compareVersions(entry.version, best.version!) ?? 0) > 0) best = entry;
  }
  return best;
}

function inRange(version: string, installed: string | null, available: string): boolean {
  const aboveInstalled = installed ? (compareVersions(version, installed) ?? 0) > 0 : true;
  const upToAvailable = (compareVersions(version, available) ?? 1) <= 0;
  return aboveInstalled && upToAvailable;
}

function bounded(sections: string[]): string | null {
  if (sections.length === 0) return null;
  let text = '';
  for (const section of sections) {
    if (text.length + section.length > NOTES_MAX_CHARS) {
      text += `\n\n… (${sections.length} versions, the older ones left out)`;
      break;
    }
    text += (text ? '\n\n' : '') + section;
  }
  return text.trim() || null;
}

// The notes of every release after `installed` up to `available`, newest first. Prereleases
// count only when `available` is one.
export function notesBetween(
  entries: FeedEntry[],
  installed: string | null,
  available: string,
): string | null {
  const wantPre = isPrerelease(available);
  const picked = entries
    .filter(
      (entry) =>
        entry.version &&
        (wantPre || !isPrerelease(entry.version)) &&
        inRange(entry.version, installed, available),
    )
    .sort((a, b) => compareVersions(b.version!, a.version!) ?? 0);
  return bounded(picked.map((entry) => `## ${entry.version}\n${entry.text || entry.title}`.trim()));
}

// A Markdown changelog with one `## <version>` heading per release (Claude Code's
// CHANGELOG.md): the sections after `installed` up to `available`, newest first.
export function changelogBetween(
  markdown: string,
  installed: string | null,
  available: string,
): string | null {
  const headings = [...markdown.matchAll(/^#{1,3}\s+\[?v?(\d+\.\d+[^\s\]]*)\]?.*$/gm)];
  const sections: { version: string; text: string }[] = [];
  headings.forEach((match, index) => {
    const start = match.index!;
    const end = index + 1 < headings.length ? headings[index + 1]!.index! : markdown.length;
    sections.push({ version: match[1]!, text: markdown.slice(start, end).trim() });
  });
  return bounded(
    sections
      .filter((section) => inRange(section.version, installed, available))
      .sort((a, b) => compareVersions(b.version, a.version) ?? 0)
      .map((section) => section.text),
  );
}

// A Debian changelog (`src (version) dist; urgency=…` entries, newest first): the entries
// before the one of the installed version.
export function debianChangelogSince(text: string, installed: string | null): string | null {
  const heads = [...text.matchAll(/^(\S+) \(([^)]+)\) [^;\n]+; urgency=\S+.*$/gm)];
  const sections: string[] = [];
  for (let index = 0; index < heads.length; index++) {
    const head = heads[index]!;
    if (installed && head[2] === installed) break;
    const end = index + 1 < heads.length ? heads[index + 1]!.index! : text.length;
    sections.push(text.slice(head.index!, end).trim());
    if (sections.length >= 10) break;
  }
  return bounded(sections);
}
