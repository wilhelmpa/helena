// The folder of an area, derived the way the api derives it
// (apps/api/src/modules/views/area-folder.ts), so the area dialog shows it before saving.

export const AREA_FOLDER_MAX_LENGTH = 64;

const PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Folders the provisioning service manages itself in the workspace and on the Files page.
const RESERVED = new Set(['assets', 'boards', 'docs', 'files', 'inbox']);

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

function areaFolderSlug(name: string): string {
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

// The folder an area of this name gets among the folders the project's other areas use.
export function defaultAreaFolder(name: string, taken: ReadonlySet<string>): string {
  const base = areaFolderSlug(name);
  let candidate = base;
  for (let suffix = 2; RESERVED.has(candidate) || taken.has(candidate); suffix++) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export type AreaFolderProblem = 'invalid' | 'reserved' | 'taken';

export function areaFolderProblem(
  folder: string,
  taken: ReadonlySet<string>,
): AreaFolderProblem | null {
  if (!PATTERN.test(folder) || folder.length > AREA_FOLDER_MAX_LENGTH) return 'invalid';
  if (RESERVED.has(folder)) return 'reserved';
  return taken.has(folder) ? 'taken' : null;
}
