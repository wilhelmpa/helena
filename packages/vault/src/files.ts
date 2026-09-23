import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { isMissing, isUnreadable, VaultError } from './errors';
import { sha256Of } from './indexer';
import {
  absoluteVaultPath,
  isSyncConflict,
  isWithin,
  joinVaultPath,
  parentPath,
  PRIVATE_DIR,
  syncConflictOriginal,
  TRASH_DIR,
} from './paths';

// File operations of the API on the vault. Every one checks that no path segment is a
// symbolic link, so a link placed in the vault cannot lead a write outside it. Folders
// are created 0770 and files 0660: the vault's group (the Plan user and the agent user)
// reads and writes what Plan writes.

export const MAX_NOTE_BYTES = 2 * 1024 * 1024;

export async function assertNoSymlink(relative: string): Promise<void> {
  let current = '';
  for (const part of relative.split('/').filter(Boolean)) {
    current = joinVaultPath(current, part);
    try {
      if ((await lstat(absoluteVaultPath(current))).isSymbolicLink()) {
        throw new VaultError(400, 'Symbolic links are not allowed');
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

async function exists(relative: string): Promise<boolean> {
  try {
    await lstat(absoluteVaultPath(relative));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function ensureFolder(relative: string): Promise<void> {
  await assertNoSymlink(relative);
  await mkdir(absoluteVaultPath(relative), { recursive: true, mode: 0o770 });
}

export interface VaultFileContent {
  bytes: Buffer;
  sha256: string;
  mtime: Date;
}

export async function readVaultFile(relative: string, maxBytes: number): Promise<VaultFileContent> {
  await assertNoSymlink(relative);
  let info;
  try {
    info = await stat(absoluteVaultPath(relative));
  } catch (error) {
    if (isMissing(error)) throw new VaultError(404, 'File not found');
    throw error;
  }
  if (!info.isFile()) throw new VaultError(400, 'Path is not a file');
  if (info.size > maxBytes) throw new VaultError(413, 'File is too large');
  const bytes = await readFile(absoluteVaultPath(relative));
  return { bytes, sha256: sha256Of(bytes), mtime: info.mtime };
}

async function currentSha(relative: string): Promise<string | null> {
  try {
    return sha256Of(await readFile(absoluteVaultPath(relative)));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

// Writes a file atomically through a hidden temporary file next to it. `expectedSha`
// null creates the file and refuses one that exists; a sha updates the file only while
// it still has that content, so an edit made elsewhere in the meantime is not lost.
export async function writeVaultFile(
  relative: string,
  bytes: Uint8Array,
  expectedSha: string | null,
): Promise<{ sha256: string; created: boolean }> {
  await ensureFolder(parentPath(relative));
  await assertNoSymlink(relative);
  const current = await currentSha(relative);
  if (expectedSha === null && current !== null) {
    throw new VaultError(409, 'A file with this name already exists', 'exists');
  }
  if (expectedSha !== null && current !== expectedSha) {
    throw new VaultError(409, 'The file changed since it was read', 'conflict');
  }
  const target = absoluteVaultPath(relative);
  const temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o660);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { sha256: sha256Of(bytes), created: current === null };
}

export async function createVaultFolder(relative: string): Promise<void> {
  if (await exists(relative))
    throw new VaultError(409, 'A file or folder with this name already exists', 'exists');
  await ensureFolder(relative);
}

export async function moveVaultPath(from: string, to: string): Promise<void> {
  if (isWithin(to, from)) throw new VaultError(400, 'A folder cannot be moved into itself');
  await assertNoSymlink(from);
  if (!(await exists(from))) throw new VaultError(404, 'File not found');
  if (await exists(to))
    throw new VaultError(409, 'A file or folder with this name already exists', 'exists');
  await ensureFolder(parentPath(to));
  await rename(absoluteVaultPath(from), absoluteVaultPath(to));
}

function withSuffix(relative: string, number: number): string {
  const extension = path.extname(relative);
  return `${relative.slice(0, relative.length - extension.length)} ${number}${extension}`;
}

// Copies a folder with everything in it, leaving out links and hidden files. Returns
// false when there is nothing to copy.
export async function copyVaultFolder(from: string, to: string): Promise<boolean> {
  await assertNoSymlink(from);
  if (!(await exists(from))) return false;
  await ensureFolder(parentPath(to));
  await cp(absoluteVaultPath(from), absoluteVaultPath(to), {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) =>
      !path.basename(source).startsWith('.') && !lstatSync(source).isSymbolicLink(),
  });
  return true;
}

// Where a path goes in the trash, at the same path below it. Private/ has a trash of its
// own, so nothing private lands in the shared one.
function trashPathOf(relative: string): string {
  if (!isWithin(relative, PRIVATE_DIR)) return joinVaultPath(TRASH_DIR, relative);
  return joinVaultPath(PRIVATE_DIR, TRASH_DIR, relative.slice(PRIVATE_DIR.length + 1));
}

// Moves a file or folder to the trash, the way Obsidian's ".trash" works. Returns the
// path in the trash.
export async function trashVaultPath(relative: string): Promise<string> {
  const first = trashPathOf(relative);
  let target = first;
  for (let number = 2; await exists(target); number += 1) target = withSuffix(first, number);
  await moveVaultPath(relative, target);
  return target;
}

// Moves a file back from the trash to where it was. `relative` is the original path.
export async function restoreVaultPath(relative: string): Promise<void> {
  await moveVaultPath(trashPathOf(relative), relative);
}

export interface SyncConflict {
  // The copy Syncthing wrote, and the file it belongs to.
  path: string;
  original: string;
  updatedAt: Date;
}

// The Syncthing conflict copies below a folder, newest first.
export async function listSyncConflicts(folder: string): Promise<SyncConflict[]> {
  const conflicts: SyncConflict[] = [];
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await readdir(absoluteVaultPath(current), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error) || isUnreadable(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      const relative = joinVaultPath(current, entry.name);
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.isFile() && isSyncConflict(relative)) {
        const info = await lstat(absoluteVaultPath(relative));
        conflicts.push({
          path: relative,
          original: syncConflictOriginal(relative),
          updatedAt: info.mtime,
        });
      }
    }
  }
  return conflicts.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export interface TrashedItem {
  // The path the file had before it was trashed, which restores it.
  path: string;
  trashedAt: Date;
}

// The files trashed from below a folder, newest first. A trashed folder shows as the
// files it held, each restorable on its own.
export async function listTrash(folder: string): Promise<TrashedItem[]> {
  const trashFolder = trashPathOf(folder);
  const items: TrashedItem[] = [];
  const pending = [''];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await readdir(absoluteVaultPath(joinVaultPath(trashFolder, current)), {
        withFileTypes: true,
      });
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const relative = joinVaultPath(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(relative);
        continue;
      }
      const info = await lstat(absoluteVaultPath(joinVaultPath(trashFolder, relative)));
      items.push({ path: joinVaultPath(folder, relative), trashedAt: info.ctime });
    }
  }
  return items.sort((a, b) => b.trashedAt.getTime() - a.trashedAt.getTime());
}
