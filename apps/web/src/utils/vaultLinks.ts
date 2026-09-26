import { documentsPath } from './paths';

// Links from a vault file to the other places that open it.

// A page of the notes (SilverBullet) by its name, encoded the way SilverBullet itself builds
// its addresses (encodeURIComponent, the slashes kept).
export function notesPageUrl(notesBase: string, page: string): string {
  if (!notesBase) return '';
  try {
    const base = new URL(notesBase);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return '';
    return `${base.origin}/${encodeURIComponent(page).replace(/%2F/g, '/')}`;
  } catch {
    return '';
  }
}

// What the notes can open: every vault file except the owner's Private/ folder (the notes
// cannot read it), hidden files, boards (JSON Canvas, Helena's board view edits them) and
// names SilverBullet refuses ("|", "@", "#", "[[", "]]", a segment starting with a dot).
export function notesFileUrl(notesBase: string, vaultPath: string): string {
  const parts = vaultPath.split('/');
  if (!vaultPath || parts[0] === 'Private' || parts.some((part) => !part || part.startsWith('.')))
    return '';
  if (/\.canvas$/i.test(vaultPath) || /[|@#]|\[\[|\]\]/.test(vaultPath)) return '';
  const page = /\.md$/i.test(vaultPath) ? vaultPath.replace(/\.md$/i, '') : vaultPath;
  return notesPageUrl(notesBase, page);
}

// Where the notes open for a project or for Home: the folder's page ("ordner:<folder>", a
// page of the notes' settings, deployment/volition-stack/native/notes/CONFIG.md.in).
export const notesFolderUrl = (notesBase: string, projectKey: string | null) =>
  notesPageUrl(notesBase, `ordner:${projectKey ? `Projects/${projectKey}` : 'Home'}`);

// The Files page opens its current vault folder in SilverBullet. Its virtual folder page
// uses the same vault, but SilverBullet cannot see Private/ or hidden paths.
export function notesVaultFolderUrl(notesBase: string, vaultFolder: string): string {
  const parts = vaultFolder.split('/');
  if (
    !vaultFolder ||
    parts[0] === 'Private' ||
    parts.some((part) => !part || part.startsWith('.')) ||
    /[|@#]|\[\[|\]\]/.test(vaultFolder)
  )
    return '';
  return notesPageUrl(notesBase, `ordner:${vaultFolder}`);
}

// The Docs page opens a note of the vault by its vault-relative path.
export const docsFileUrl = (projectKey: string, vaultPath: string) =>
  `${documentsPath(projectKey)}?${new URLSearchParams({ path: vaultPath })}`;

// The project a vault path belongs to: Projects/<KEY>/... .
export function vaultProjectKey(vaultPath: string): string | null {
  const [top, key] = vaultPath.split('/');
  return top === 'Projects' && key ? key : null;
}

// The path below the project folder, the form the project's Files routes take.
export const projectRelativePath = (vaultPath: string) => vaultPath.split('/').slice(2).join('/');

export function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

export const childPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
