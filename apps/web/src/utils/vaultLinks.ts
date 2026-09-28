import { vaultNotePath } from './paths';

// Links from a vault file to the other places that open it.

// The Docs page opens a note of the vault by its vault-relative path.
export const docsFileUrl = (_projectKey: string, vaultPath: string) => vaultNotePath(vaultPath);

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
