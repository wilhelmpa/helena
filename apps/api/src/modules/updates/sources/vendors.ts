import type { UpdateCheckContext } from '@helena/sdk';
import { newestRelease, notesBetween, parseAtom, type FeedEntry } from '../feeds';

// The vendors' public endpoints the built-in update sources read, and small readers over
// them. No token, no account: the npm registry, GitHub's releases Atom feeds (web content,
// not the REST API, so no 60-per-hour limit), the Node.js release index, Claude Code's
// release bucket, the Debian changelogs, and OSV for advisories.

export const NPM_HOST = 'registry.npmjs.org';
export const GITHUB_HOSTS = ['github.com', 'raw.githubusercontent.com'];
export const OSV_HOST = 'api.osv.dev';

const VERSION = /^v?\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?$/;

export function plainVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return VERSION.test(trimmed) ? trimmed.replace(/^v/, '') : null;
}

// The version npm's `latest` tag points at.
export async function npmLatest(context: UpdateCheckContext, name: string): Promise<string | null> {
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : name;
  const manifest = await context.fetchJson<{ version?: unknown }>(
    `https://${NPM_HOST}/${encoded}/latest`,
    { maxBytes: 256 * 1024 },
  );
  return plainVersion(manifest.version);
}

export async function githubReleases(
  context: UpdateCheckContext,
  repository: string,
): Promise<FeedEntry[]> {
  return parseAtom(await context.fetchText(`https://github.com/${repository}/releases.atom`));
}

export async function githubNewest(
  context: UpdateCheckContext,
  repository: string,
): Promise<string | null> {
  return newestRelease(await githubReleases(context, repository))?.version ?? null;
}

export async function githubNotes(
  context: UpdateCheckContext,
  repository: string,
  installed: string | null,
  available: string,
): Promise<string | null> {
  return notesBetween(await githubReleases(context, repository), installed, available);
}

// Whether OSV knows an advisory against this version of the npm package. A failed query
// counts as "no": the security badge is a hint, the version facts do not depend on it.
export async function osvAffected(
  context: UpdateCheckContext,
  name: string,
  version: string,
): Promise<boolean> {
  try {
    const answer = await context.fetchJson<{ vulns?: unknown[] }>(`https://${OSV_HOST}/v1/query`, {
      method: 'POST',
      body: JSON.stringify({ package: { name, ecosystem: 'npm' }, version }),
      headers: { 'Content-Type': 'application/json' },
      maxBytes: 256 * 1024,
    });
    return Array.isArray(answer.vulns) && answer.vulns.length > 0;
  } catch (error) {
    context.log.warn(`OSV query for ${name} failed: ${String(error)}`);
    return false;
  }
}

// The facts the root helper reported about the host (helena-update inventory), typed loosely:
// every field is checked where it is read.
export interface HostInventory {
  apt?: {
    listsUpdatedAt?: string | null;
    os?: string | null;
    packages?: {
      source?: string;
      component?: string;
      installed?: string;
      candidate?: string;
      origin?: string;
      security?: boolean;
      packages?: string[];
    }[];
  };
  runtimes?: Record<string, { current?: string | null; pinned?: string | null } | undefined>;
  tools?: Record<string, string | null | undefined>;
  system?: { rebootRequired?: boolean; failedUnits?: string[] };
}

export async function hostInventory(context: UpdateCheckContext): Promise<HostInventory | null> {
  return (await context.inventory()) as HostInventory | null;
}
