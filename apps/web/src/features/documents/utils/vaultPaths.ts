// Vault-relative paths as the API writes them: "/"-separated, without a leading slash.

export const parentPath = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

export const isNotePath = (path: string) => /\.md$/i.test(path);

export const noteName = (path: string) => baseName(path).replace(/\.md$/i, '');

export const isWithin = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

// The folders between the root and a path, outermost first.
export function foldersBetween(root: string, path: string): string[] {
  if (!path.startsWith(`${root}/`)) return [];
  const folders: string[] = [];
  for (let folder = parentPath(path); folder !== root && isWithin(folder, root);) {
    folders.unshift(folder);
    folder = parentPath(folder);
  }
  return folders;
}

// A typed name as a file name: a "/" would make a subfolder and a leading dot hides
// the file from the vault. Null when nothing is left.
export function cleanFileName(name: string): string | null {
  const cleaned = name
    .replaceAll('/', '-')
    .replace(/^[\s.]+/, '')
    .trim();
  return cleaned || null;
}
