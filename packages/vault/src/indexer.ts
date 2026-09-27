import { createHash } from 'node:crypto';
import { createReadStream, type Stats } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { canvasText } from './canvas';
import { isMissing, isUnreadable } from './errors';
import { extractLinks, noteTitle, splitNote } from './markdown';
import { mimeFromName } from '@repo/storage/mime';
import { isTextFile } from './mime';
import {
  absoluteVaultPath,
  baseName,
  isCanvasPath,
  isIgnoredPath,
  isNotePath,
  joinVaultPath,
} from './paths';
import { isExtractable } from './extract';
import { writtenByNotes } from './writers';
import {
  allIndexedFiles,
  entriesWithSha,
  entryValues,
  findEntry,
  indexedPathsBelow,
  moveEntries,
  removeEntries,
  saveEntry,
  touchEntry,
  type VaultEntryRow,
} from './store';

// Text files above this size are indexed by name only.
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function hashFile(absolute: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(absolute)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function mtimeOf(stats: Stats): Date {
  return new Date(Math.floor(stats.mtimeMs));
}

function unchangedOnDisk(entry: VaultEntryRow, stats: Stats): boolean {
  return entry.sizeBytes === stats.size && entry.mtime?.getTime() === mtimeOf(stats).getTime();
}

// Null for a path that is gone, or one inside a folder the process may not read.
async function statPath(relative: string): Promise<Stats | null> {
  try {
    return await lstat(absoluteVaultPath(relative));
  } catch (error) {
    if (isMissing(error) || isUnreadable(error)) return null;
    throw error;
  }
}

// Every folder and file below a folder, skipping what the index leaves out and links.
export async function walkVault(folder: string): Promise<string[]> {
  const found: string[] = [];
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
      if (isIgnoredPath(relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        found.push(relative);
        pending.push(relative);
      } else if (entry.isFile()) {
        found.push(relative);
      }
    }
  }
  return found;
}

async function saveFolder(relative: string, stats: Stats): Promise<void> {
  await saveEntry(
    {
      path: relative,
      kind: 'folder',
      mime: null,
      sizeBytes: null,
      mtime: mtimeOf(stats),
      sha256: null,
      title: baseName(relative),
      frontmatter: {},
      text: null,
      extractionStatus: 'none',
      extractionError: null,
    },
    null,
  );
}

// Who wrote a change the index records: the API names the person or agent it wrote
// for; a change the watcher or a rescan finds on disk came from outside Helena.
export interface VaultWriteProvenance {
  author: string;
  runId?: number | null;
}

export const EXTERNAL_PROVENANCE: VaultWriteProvenance = { author: 'extern' };

// A change the notes made (SilverBullet: writers.ts), found on disk like any outside change.
export const NOTES_PROVENANCE: VaultWriteProvenance = { author: 'notes' };

async function saveFile(
  relative: string,
  stats: Stats,
  knownSha: string | undefined,
  provenance: VaultWriteProvenance,
): Promise<void> {
  const absolute = absoluteVaultPath(relative);
  const base = {
    path: relative,
    mime: mimeFromName(relative),
    sizeBytes: stats.size,
    mtime: mtimeOf(stats),
    lastAuthor: provenance.author,
    lastRunId: provenance.runId ?? null,
  };
  if (isTextFile(relative) && stats.size <= MAX_TEXT_BYTES) {
    const bytes = await readFile(absolute);
    const content = bytes.toString('utf8');
    const sha256 = sha256Of(bytes);
    if (isNotePath(relative)) {
      const note = splitNote(content);
      await saveEntry(
        {
          ...base,
          kind: 'note',
          sha256,
          title: noteTitle(note.frontmatter, relative),
          frontmatter: note.frontmatter,
          text: note.body,
          extractionStatus: 'none',
          extractionError: null,
        },
        extractLinks(content, relative),
      );
      return;
    }
    // A board (JSON Canvas) is indexed by its cards' words and the notes it links, not
    // by its JSON.
    const board = isCanvasPath(relative);
    const text = board ? canvasText(content) : content;
    await saveEntry(
      {
        ...base,
        kind: 'file',
        sha256,
        title: board ? baseName(relative).replace(/\.canvas$/i, '') : baseName(relative),
        frontmatter: {},
        text,
        extractionStatus: 'done',
        extractionError: null,
      },
      board ? extractLinks(text, relative) : null,
    );
    return;
  }
  await saveEntry(
    {
      ...base,
      kind: isNotePath(relative) ? 'note' : 'file',
      sha256: knownSha ?? (await hashFile(absolute)),
      title: isNotePath(relative) ? noteTitle({}, relative) : baseName(relative),
      frontmatter: {},
      text: null,
      extractionStatus: isExtractable(relative) ? 'pending' : 'skipped',
      extractionError: null,
    },
    null,
  );
}

// A new file whose content an indexed file that is gone had: the same file, moved. Its
// row moves with it, keeping the links to it and its extracted text.
async function takeOverMovedEntry(
  relative: string,
  sha256: string,
  gone: Set<string>,
): Promise<boolean> {
  for (const candidate of await entriesWithSha(sha256, relative)) {
    if (candidate.kind === 'folder') continue;
    if (!gone.has(candidate.path) && (await statPath(candidate.path)) !== null) continue;
    await moveEntries(candidate.path, relative);
    gone.delete(candidate.path);
    return true;
  }
  return false;
}

async function indexExisting(
  relative: string,
  stats: Stats,
  gone: Set<string>,
  provenance: VaultWriteProvenance,
): Promise<void> {
  if (stats.isDirectory()) {
    await saveFolder(relative, stats);
    return;
  }
  if (!stats.isFile()) return;
  const entry = await findEntry(relative);
  if (entry && entry.kind !== 'folder' && unchangedOnDisk(entry, stats)) return;
  const sha256 = await hashFile(absoluteVaultPath(relative));
  if (entry?.sha256 === sha256) {
    // The same content: an outside look (the watcher after the API's own write) keeps
    // the author the API recorded; the API's own index call names it.
    await touchEntry(
      entry.id,
      mtimeOf(stats),
      stats.size,
      provenance === EXTERNAL_PROVENANCE ? undefined : provenance,
    );
    return;
  }
  if (!entry && (await takeOverMovedEntry(relative, sha256, gone))) {
    // The file's name or folder changed, which changes a note's title and where its
    // relative links point; the text and extraction carry over.
    if (isTextFile(relative)) {
      await saveFile(relative, stats, sha256, provenance);
    } else {
      const moved = (await findEntry(relative))!;
      await saveEntry(
        {
          ...entryValues(moved),
          title: baseName(relative),
          mtime: mtimeOf(stats),
          sizeBytes: stats.size,
        },
        null,
      );
    }
    return;
  }
  await saveFile(relative, stats, sha256, provenance);
}

// Brings the index in line with the given vault paths, which changed on disk: each is
// indexed again if it exists (a folder with everything in it) and removed if it does
// not. The paths that exist are handled first, so a file that disappeared at one path
// and appeared at another in the same batch is recognised as moved.
export async function indexVaultPaths(
  relativePaths: string[],
  provenance: VaultWriteProvenance = EXTERNAL_PROVENANCE,
  options: { throwOnError?: boolean } = {},
): Promise<void> {
  const present = new Map<string, Stats>();
  const gone = new Set<string>();
  for (const relative of new Set(relativePaths)) {
    if (!relative || isIgnoredPath(relative)) continue;
    const stats = options.throwOnError
      ? await lstat(absoluteVaultPath(relative))
      : await statPath(relative);
    if (options.throwOnError && stats?.isSymbolicLink())
      throw new Error('Cannot index a symbolic link');
    if (!stats || stats.isSymbolicLink()) {
      for (const indexed of await indexedPathsBelow(relative)) gone.add(indexed);
      continue;
    }
    present.set(relative, stats);
    if (stats.isDirectory()) {
      for (const inner of await walkVault(relative)) {
        const innerStats = await statPath(inner);
        if (innerStats) present.set(inner, innerStats);
      }
      for (const indexed of await indexedPathsBelow(relative)) {
        if (!present.has(indexed)) gone.add(indexed);
      }
    }
  }
  const ordered = [...present.keys()].sort();
  for (const relative of ordered) {
    try {
      const stats = present.get(relative)!;
      const author =
        provenance === EXTERNAL_PROVENANCE && writtenByNotes(stats) ? NOTES_PROVENANCE : provenance;
      await indexExisting(relative, stats, gone, author);
    } catch (error) {
      if (options.throwOnError) throw error;
      if (isMissing(error)) gone.add(relative);
      else if (!isUnreadable(error)) console.error(`[vault] indexing ${relative} failed:`, error);
    }
  }
  for (const relative of gone) {
    if (!present.has(relative) || (await statPath(relative)) === null) {
      await removeEntries(relative);
    }
  }
}

// The whole vault against the index: paths that appeared, changed (by size or
// modification time) or disappeared since the index last saw them go through
// indexVaultPaths. Repairs whatever the watcher missed.
export async function rescanVault(): Promise<{ changed: number }> {
  const indexed = new Map((await allIndexedFiles()).map((row) => [row.path, row]));
  const changed: string[] = [];
  for (const relative of await walkVault('')) {
    const row = indexed.get(relative);
    indexed.delete(relative);
    const stats = await statPath(relative);
    if (!stats) continue;
    const isFolder = stats.isDirectory();
    if (
      !row ||
      (row.kind === 'folder') !== isFolder ||
      (!isFolder &&
        (row.sizeBytes !== stats.size || row.mtime?.getTime() !== mtimeOf(stats).getTime()))
    ) {
      changed.push(relative);
    }
  }
  changed.push(...indexed.keys());
  await indexVaultPaths(changed);
  return { changed: changed.length };
}
