import { HttpError } from '#shared/lib';

// The folder of an area is one path segment below the project workspace and the
// project's vault folder. The web app's utils/areaFolder.ts and the backfill in
// packages/db/drizzle/0149_area_folders.sql derive the same default.

export const AREA_FOLDER_PATTERN = '^[a-z0-9][a-z0-9-]*$';
export const AREA_FOLDER_MAX_LENGTH = 64;

// Folders the provisioning service manages itself: boards/ in the workspace, and
// Assets/, Docs/, Files/ and Inbox/ in the vault, which a case-insensitive file system
// of a synced client would merge with an area of the same name.
const RESERVED = new Set(['assets', 'boards', 'docs', 'files', 'inbox']);

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

export function areaFolderSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => UMLAUTS[char])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'area';
}

export function uniqueAreaFolder(base: string, taken: ReadonlySet<string>): string {
  let candidate = base;
  for (let suffix = 2; RESERVED.has(candidate) || taken.has(candidate); suffix++) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export function assertAreaFolder(folder: string, taken: ReadonlySet<string>): void {
  if (RESERVED.has(folder)) {
    throw new HttpError(400, `The folder name "${folder}" is reserved for project files`);
  }
  if (taken.has(folder)) throw new HttpError(409, 'Another area of this project uses this folder');
}
