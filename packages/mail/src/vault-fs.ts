import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { withSuffix } from './vault-path';

// File access below PROJECT_VAULT_ROOT for mail attachments and mail notes. Agents
// write into the vault too, so every existing segment of a path is checked for a
// symbolic link before anything is written through it.

const DEFAULT_VAULT_ROOT = '/srv/volition/vault';
const MAX_ATTEMPTS = 100;

export function vaultRoot(): string {
  return path.resolve(process.env.PROJECT_VAULT_ROOT?.trim() || DEFAULT_VAULT_ROOT);
}

export function vaultAbsolute(relative: string): string {
  const parts = relative.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('Invalid vault path');
  }
  const root = vaultRoot();
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Invalid vault path');
  return target;
}

async function exists(target: string): Promise<boolean> {
  return lstat(target).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
}

export async function assertNoSymlinks(relative: string): Promise<void> {
  let current = vaultRoot();
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    const entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!entry) return;
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in the vault');
  }
}

async function ensureFolder(relative: string): Promise<void> {
  await assertNoSymlinks(relative);
  await mkdir(vaultAbsolute(relative), { recursive: true, mode: 0o770 });
}

export async function vaultFileSha256(relative: string): Promise<string | null> {
  const target = vaultAbsolute(relative);
  if (!(await exists(target))) return null;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function writeExclusive(relative: string, content: Buffer | string): Promise<boolean> {
  try {
    const handle = await open(vaultAbsolute(relative), 'wx', 0o660);
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

// Writes a file into a folder under the given name, or under "name (2)" and so on
// when another file holds the name. A file that already has the same content is
// reused, so an import that is repeated after a crash writes nothing twice.
export async function writeVaultFile(
  folder: string,
  name: string,
  content: Buffer,
  sha256: string,
): Promise<string> {
  await ensureFolder(folder);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const relative = `${folder}/${withSuffix(name, attempt, true)}`;
    if (await writeExclusive(relative, content)) return relative;
    if ((await vaultFileSha256(relative)) === sha256) return relative;
  }
  throw new Error('No free file name in the vault folder');
}

// Writes a new text file, adding " (2)" and so on to the name while one exists.
export async function writeNewVaultText(relative: string, content: string): Promise<string> {
  const folder = path.posix.dirname(relative);
  const name = path.posix.basename(relative);
  await ensureFolder(folder);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const candidate = `${folder}/${withSuffix(name, attempt, true)}`;
    if (await writeExclusive(candidate, content)) return candidate;
  }
  throw new Error('No free file name in the vault folder');
}

// The first of folder, "folder (2)", ... that `taken` does not claim. A folder that
// exists on disk but that no mail row points at is reused: it is what an import
// interrupted before its database write left behind.
export async function pickVaultFolder(
  folder: string,
  taken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const candidate = withSuffix(folder, attempt, false);
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error('No free folder name in the vault');
}

// Moves a folder to a new place, adding " (2)" and so on when the target exists, and
// removes the parent folders the move left empty. Returns the path it ended up at.
export async function moveVaultFolder(from: string, to: string): Promise<string> {
  await assertNoSymlinks(from);
  if (!(await exists(vaultAbsolute(from)))) return to;
  await ensureFolder(path.posix.dirname(to));
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const candidate = withSuffix(to, attempt, false);
    if (await exists(vaultAbsolute(candidate))) continue;
    await rename(vaultAbsolute(from), vaultAbsolute(candidate));
    await removeEmptyParents(path.posix.dirname(from));
    return candidate;
  }
  throw new Error('No free folder name in the vault');
}

// The month and year folders a moved mail folder leaves behind.
async function removeEmptyParents(relative: string): Promise<void> {
  let current = relative;
  for (let level = 0; level < 2; level += 1) {
    const entries = await readdir(vaultAbsolute(current)).catch(() => null);
    if (!entries || entries.length > 0) return;
    await rmdir(vaultAbsolute(current)).catch(() => undefined);
    current = path.posix.dirname(current);
  }
}
