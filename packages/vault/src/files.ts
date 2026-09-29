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
  normalizeVaultPath,
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

interface TrashRecord {
  original: string;
  target: string;
  trashedAt: string;
  recordPath: string;
}

function canonicalRecordPath(value: string): boolean {
  try {
    return normalizeVaultPath(value) === value;
  } catch {
    return false;
  }
}

function trashRoot(relative: string): string {
  return isWithin(relative, PRIVATE_DIR) ? `${PRIVATE_DIR}/${TRASH_DIR}` : TRASH_DIR;
}

async function trashRecords(root: string): Promise<TrashRecord[]> {
  const folder = joinVaultPath(root, '.records');
  const names = await readdir(absoluteVaultPath(folder)).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });
  const records: TrashRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const recordPath = joinVaultPath(folder, name);
    await assertNoSymlink(recordPath);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(absoluteVaultPath(recordPath), 'utf8'));
    } catch {
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (
      typeof record.original !== 'string' ||
      typeof record.target !== 'string' ||
      typeof record.trashedAt !== 'string' ||
      !canonicalRecordPath(record.original) ||
      !canonicalRecordPath(record.target) ||
      !isWithin(record.target, root) ||
      !Number.isFinite(Date.parse(record.trashedAt))
    )
      continue;
    records.push({
      original: record.original,
      target: record.target,
      trashedAt: record.trashedAt,
      recordPath,
    });
  }
  return records;
}

// Moves a file or folder to the trash, the way Obsidian's ".trash" works. Returns the
// path in the trash.
export async function trashVaultPath(relative: string): Promise<string> {
  const first = trashPathOf(relative);
  let target = first;
  const records = await trashRecords(trashRoot(relative));
  for (let number = 2; ; number += 1) {
    const parentRecord = records.find(
      (record) => target !== record.target && isWithin(target, record.target),
    );
    if (parentRecord) {
      target = withSuffix(parentRecord.target, number) + target.slice(parentRecord.target.length);
    } else if (await exists(target)) {
      target = withSuffix(first, number);
    } else break;
    if (number > 1000) throw new VaultError(409, 'No free trash path is available');
  }
  await moveVaultPath(relative, target);
  try {
    const recordPath = joinVaultPath(trashRoot(relative), '.records', `${randomUUID()}.json`);
    await writeVaultFile(
      recordPath,
      Buffer.from(
        JSON.stringify({ original: relative, target, trashedAt: new Date().toISOString() }),
      ),
      null,
    );
  } catch (error) {
    await moveVaultPath(target, relative);
    throw error;
  }
  return target;
}

// Moves a file back from the trash to where it was. `relative` is the original path.
export async function restoreVaultPath(relative: string): Promise<void> {
  const records = (await trashRecords(trashRoot(relative)))
    .filter((record) => record.original === relative)
    .sort((a, b) => a.trashedAt.localeCompare(b.trashedAt));
  const record = records.find((item) =>
    lstatSync(absoluteVaultPath(item.target), { throwIfNoEntry: false }),
  );
  await moveVaultPath(record?.target ?? trashPathOf(relative), relative);
  if (record) await rm(absoluteVaultPath(record.recordPath));
}

export async function purgeVaultTrash(input: {
  olderThanDays: number;
  apply?: boolean;
  confirmTargets?: string[];
}): Promise<{ targets: string[]; applied: boolean }> {
  if (
    !Number.isInteger(input.olderThanDays) ||
    input.olderThanDays < 1 ||
    input.olderThanDays > 3650
  ) {
    throw new VaultError(400, 'olderThanDays must be between 1 and 3650');
  }
  const before = Date.now() - input.olderThanDays * 86_400_000;
  const allRecords = (
    await Promise.all([trashRecords(TRASH_DIR), trashRecords(`${PRIVATE_DIR}/${TRASH_DIR}`)])
  ).flat();
  const records = allRecords
    .filter((record) => Date.parse(record.trashedAt) < before)
    .filter(
      (record) =>
        !allRecords.some((other) => other !== record && isWithin(other.target, record.target)),
    )
    .sort((a, b) => a.target.localeCompare(b.target));
  const targets = records.map((record) => record.target);
  if (input.apply) {
    if (JSON.stringify([...(input.confirmTargets ?? [])].sort()) !== JSON.stringify(targets)) {
      throw new VaultError(409, 'The trash changed; run the dry run again before applying');
    }
    for (const record of records) {
      await assertNoSymlink(record.target);
      await rm(absoluteVaultPath(record.target), { recursive: true, force: true });
      await rm(absoluteVaultPath(record.recordPath));
    }
  }
  return { targets, applied: input.apply === true };
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

// The items trashed from below a folder, newest first. New entries use records, so a
// trashed folder is one restorable item; legacy entries remain discoverable by scanning.
export async function listTrash(folder: string): Promise<TrashedItem[]> {
  const trashFolder = trashPathOf(folder);
  const records = await trashRecords(trashRoot(folder));
  const recordedTargets = new Set(records.map((record) => record.target));
  const items: TrashedItem[] = records
    .filter((record) => isWithin(record.original, folder))
    .map((record) => ({ path: record.original, trashedAt: new Date(record.trashedAt) }));
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
        if (recordedTargets.has(joinVaultPath(trashFolder, relative))) continue;
        pending.push(relative);
        continue;
      }
      if (recordedTargets.has(joinVaultPath(trashFolder, relative))) continue;
      const info = await lstat(absoluteVaultPath(joinVaultPath(trashFolder, relative)));
      items.push({ path: joinVaultPath(folder, relative), trashedAt: info.ctime });
    }
  }
  return items.sort((a, b) => b.trashedAt.getTime() - a.trashedAt.getTime());
}
