import path from 'node:path';
import { VaultError } from './errors';

const DEFAULT_VAULT_ROOT = '/srv/volition/vault';

export const HOME_DIR = 'Home';
export const PROJECTS_DIR = 'Projects';
export const TEMPLATES_DIR = 'Templates';
export const PRIVATE_DIR = 'Private';
export const TRASH_DIR = '.trash';
export const DOCS_DIR = 'Docs';
export const ASSETS_DIR = 'Assets';

export function vaultRoot(): string {
  return path.resolve(process.env.PROJECT_VAULT_ROOT?.trim() || DEFAULT_VAULT_ROOT);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

// A vault-relative path as the API and the index store it: '/'-separated, no leading or
// trailing slash, no empty, "." or ".." segment. The empty string is the vault root.
export function normalizeVaultPath(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (Buffer.byteLength(trimmed) > 1024) throw new VaultError(400, 'Path is too long');
  if (!trimmed) return '';
  const parts = trimmed.split('/');
  if (
    parts.length > 32 ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        Buffer.byteLength(part) > 255 ||
        part !== part.trim() ||
        hasControlCharacter(part),
    )
  ) {
    throw new VaultError(400, 'Path is invalid');
  }
  return parts.join('/');
}

export function absoluteVaultPath(relative: string): string {
  const root = vaultRoot();
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new VaultError(400, 'Path is invalid');
  }
  return target;
}

// Folders the index and the API leave alone: version control, a desktop editor's own state
// (.obsidian, left over from before the notes), the trash, and Syncthing's markers.
const IGNORED_SEGMENTS = new Set(['.git', '.obsidian', TRASH_DIR, '.stfolder', '.stversions']);

// The notes (SilverBullet, deployment/volition-stack/native/notes) keep their settings page
// and any library of theirs at the vault root; neither is knowledge. Their writes go to a
// hidden sibling first (".Note.md.sb-write-<pid>-<n>", renamed over the note), and on start
// they probe the root once (".sb-case-probe-<pid>-<n>").
export const NOTES_CONFIG_PAGE = 'CONFIG.md';
const NOTES_LIBRARY_DIR = 'Library';
const NOTES_TEMPORARY = /^\..+\.sb-write-\d+-\d+$|^\.sb-case-probe-/;

// The copy Syncthing keeps of a file two devices changed at the same time:
// "Note.sync-conflict-20260923-101500-ABCDEF7.md" beside "Note.md".
const SYNC_CONFLICT = /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}/;

export function isSyncConflict(relative: string): boolean {
  return SYNC_CONFLICT.test(baseName(relative));
}

// The file a conflict copy belongs to.
export function syncConflictOriginal(relative: string): string {
  return joinVaultPath(parentPath(relative), baseName(relative).replace(SYNC_CONFLICT, ''));
}

// Paths the index leaves out. A Syncthing conflict copy is listed on its own (see
// listSyncConflicts), not indexed as a second note.
export function isIgnoredPath(relative: string): boolean {
  const parts = relative.split('/');
  const name = parts[parts.length - 1] ?? '';
  return (
    parts.some((part) => IGNORED_SEGMENTS.has(part)) ||
    name === '.DS_Store' ||
    name === '.stignore' ||
    name.endsWith('.tmp') ||
    name.startsWith('.~') ||
    name.startsWith('.syncthing.') ||
    SYNC_CONFLICT.test(name) ||
    NOTES_TEMPORARY.test(name) ||
    relative === NOTES_CONFIG_PAGE ||
    parts[0] === NOTES_LIBRARY_DIR
  );
}

// A path the API may read or write on a caller's behalf: nothing hidden. The trash is
// reached only through the trash and restore routes.
export function isHiddenPath(relative: string): boolean {
  return relative.split('/').some((part) => part.startsWith('.'));
}

export interface VaultLocation {
  scope: 'project' | 'home' | 'templates' | 'private' | 'root';
  projectKey: string | null;
}

export function locateVaultPath(relative: string): VaultLocation {
  const [top, second] = relative.split('/');
  if (top === PROJECTS_DIR && second) return { scope: 'project', projectKey: second };
  if (top === HOME_DIR) return { scope: 'home', projectKey: null };
  if (top === TEMPLATES_DIR) return { scope: 'templates', projectKey: null };
  if (top === PRIVATE_DIR) return { scope: 'private', projectKey: null };
  return { scope: 'root', projectKey: null };
}

export function projectFolder(projectKey: string): string {
  return `${PROJECTS_DIR}/${projectKey}`;
}

// The root of the Docs tree: a project's Docs folder, or Home/Docs for Home.
export function docsRoot(projectKey: string | null): string {
  return projectKey ? `${projectFolder(projectKey)}/${DOCS_DIR}` : `${HOME_DIR}/${DOCS_DIR}`;
}

// Where images pasted into a note are stored: an Assets folder beside the note, which
// is where Obsidian puts the attachments of a note too.
export function assetsFolderFor(notePath: string): string {
  return joinVaultPath(parentPath(notePath), ASSETS_DIR);
}

export function isNotePath(relative: string): boolean {
  return /\.md$/i.test(relative);
}

// A board: a JSON Canvas file (canvas.ts).
export function isCanvasPath(relative: string): boolean {
  return /\.canvas$/i.test(relative);
}

// Where a project's boards are kept.
export const BOARDS_DIR = 'Boards';

export function parentPath(relative: string): string {
  const index = relative.lastIndexOf('/');
  return index === -1 ? '' : relative.slice(0, index);
}

export function baseName(relative: string): string {
  return relative.slice(relative.lastIndexOf('/') + 1);
}

export function joinVaultPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

// Whether `relative` is `prefix` itself or inside it. The empty prefix is the root.
export function isWithin(relative: string, prefix: string): boolean {
  return prefix === '' || relative === prefix || relative.startsWith(`${prefix}/`);
}
