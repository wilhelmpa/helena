import type {
  CatalogFinding,
  CatalogItemRow,
  CatalogPreview,
  CatalogRevision,
  CatalogSnapshotFile,
  CatalogSourceKind,
} from '@/lib/api/endpoints/catalog';

// A skill is a SKILL.md with references; everything else the catalog lists is an MCP server.
export const isSkillKind = (kind: CatalogSourceKind) => kind === 'github-skills';

// A commit is shown with its first seven characters, a package version as it is. GitHub
// MCP entries carry both ("<commit>@<version>").
export function shortPin(pin: string): string {
  const match = /^([a-f0-9]{40})(?:@(.+))?$/i.exec(pin);
  if (!match) return pin;
  const commit = match[1]!.slice(0, 7);
  return match[2] ? `${commit} · ${match[2]}` : commit;
}

// A hash without its tail: enough to tell two versions apart, the whole value is copied.
export const shortHash = (hash: string) => hash.slice(0, 10);

// "github.com/org/repo" without the scheme; a package name stays as it is.
export function sourceLabel(locator: string): string {
  return locator.replace(/^https:\/\/(?:www\.)?github\.com\//, '');
}

// The catalog keeps file contents base64-encoded; an empty value is a file the inspection
// hid because it looked like a secret.
export function decodeContent(file: CatalogSnapshotFile | null | undefined): string | null {
  if (!file || file.content === '') return null;
  try {
    const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}

export const isMarkdownFile = (path: string) => /\.(?:md|markdown)$/i.test(path);

// The SKILL.md front matter is the name and use of the skill, which the preview shows itself.
export function withoutFrontMatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/, '');
}

export type Verdict = 'blocked' | 'review' | 'clean';

// What the inspection means for adoption: a blocking finding forbids it, a review finding
// needs the owner's explicit confirmation, anything else (info) is only shown.
export function verdictOf(findings: CatalogFinding[]): Verdict {
  if (findings.some((finding) => finding.severity === 'block')) return 'blocked';
  if (findings.some((finding) => finding.severity === 'review')) return 'review';
  return 'clean';
}

// The revision the owner is asked about: the latest inspected one.
export function installedRevision(preview: CatalogPreview) {
  const id = preview.install?.revisionId;
  return id == null ? null : (preview.revisions.find((revision) => revision.id === id) ?? null);
}

// A newer inspected version of an installed item waits to be adopted.
export function hasNewVersion(
  row: Pick<CatalogItemRow, 'installed' | 'installedPin' | 'latestPin'>,
) {
  return row.installed && row.latestPin != null && row.latestPin !== row.installedPin;
}

// Which files of a version are scripts (the inspection lists them as executable).
export function scriptPaths(revision: CatalogRevision | null): Set<string> {
  return new Set(
    (revision?.findings ?? [])
      .filter((finding) => finding.code === 'executable' && finding.path)
      .map((finding) => finding.path),
  );
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
