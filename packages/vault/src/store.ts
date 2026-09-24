import { and, desc, eq, inArray, like, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  db,
  project,
  vaultEntry,
  vaultLink,
  vaultMove,
  type VaultEntryKind,
  type VaultExtractionStatus,
  escapeLike,
} from '@repo/db';
import type { Frontmatter, NoteLink } from './markdown';
import { locateVaultPath } from './paths';

export type VaultEntryRow = typeof vaultEntry.$inferSelect;

export interface EntryValues {
  path: string;
  kind: VaultEntryKind;
  mime: string | null;
  sizeBytes: number | null;
  mtime: Date | null;
  sha256: string | null;
  title: string;
  frontmatter: Frontmatter;
  text: string | null;
  extractionStatus: VaultExtractionStatus;
  extractionError: string | null;
}

export function entryValues(row: VaultEntryRow): EntryValues {
  return {
    path: row.path,
    kind: row.kind,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    mtime: row.mtime,
    sha256: row.sha256,
    title: row.title,
    frontmatter: row.frontmatter,
    text: row.text,
    extractionStatus: row.extractionStatus,
    extractionError: row.extractionError,
  };
}

// A LIKE pattern for everything below a folder, with the folder's own wildcards escaped.
export function belowPattern(folder: string): string {
  return `${escapeLike(folder)}/%`;
}

// The path itself and everything below it.
export function pathOrBelow(folder: string): SQL {
  return or(eq(vaultEntry.path, folder), like(vaultEntry.path, belowPattern(folder)))!;
}

export async function projectIdForPath(relative: string): Promise<number | null> {
  const { projectKey } = locateVaultPath(relative);
  if (!projectKey) return null;
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.key, projectKey));
  return row?.id ?? null;
}

export async function findEntry(relative: string): Promise<VaultEntryRow | null> {
  const [row] = await db.select().from(vaultEntry).where(eq(vaultEntry.path, relative));
  return row ?? null;
}

// Writes one entry and, for a note, replaces the links it makes.
export async function saveEntry(values: EntryValues, links: NoteLink[] | null): Promise<number> {
  const projectId = await projectIdForPath(values.path);
  return db.transaction(async (tx) => {
    const row = { ...values, projectId, indexedAt: new Date() };
    const [saved] = await tx
      .insert(vaultEntry)
      .values(row)
      .onConflictDoUpdate({ target: vaultEntry.path, set: row })
      .returning({ id: vaultEntry.id });
    if (links !== null) {
      await tx.delete(vaultLink).where(eq(vaultLink.entryId, saved.id));
      if (links.length > 0) {
        await tx.insert(vaultLink).values(links.map((link) => ({ ...link, entryId: saved.id })));
      }
    }
    return saved.id;
  });
}

export async function touchEntry(id: number, mtime: Date, sizeBytes: number): Promise<void> {
  await db
    .update(vaultEntry)
    .set({ mtime, sizeBytes, indexedAt: new Date() })
    .where(eq(vaultEntry.id, id));
}

export async function removeEntries(relative: string): Promise<void> {
  await db.delete(vaultEntry).where(pathOrBelow(relative));
}

// The indexed paths at and below a folder, for a folder that disappeared.
export async function indexedPathsBelow(relative: string): Promise<string[]> {
  const rows = await db
    .select({ path: vaultEntry.path })
    .from(vaultEntry)
    .where(pathOrBelow(relative));
  return rows.map((row) => row.path);
}

// Files elsewhere with the same content: the candidates a new path may have moved from.
export async function entriesWithSha(sha256: string, except: string): Promise<VaultEntryRow[]> {
  return db
    .select()
    .from(vaultEntry)
    .where(and(eq(vaultEntry.sha256, sha256), ne(vaultEntry.path, except)));
}

// Moves index rows from one path to another: the path itself and, for a folder, all it
// holds. The rows keep their id, so the links they make and the links to them stay. Each
// moved file is recorded for the resolver.
export async function moveEntries(from: string, to: string): Promise<void> {
  const projectId = await projectIdForPath(to);
  await db.transaction(async (tx) => {
    const moved = await tx
      .select({ path: vaultEntry.path, sha256: vaultEntry.sha256, kind: vaultEntry.kind })
      .from(vaultEntry)
      .where(pathOrBelow(from));
    if (moved.length === 0) return;
    await tx.delete(vaultEntry).where(pathOrBelow(to));
    await tx
      .update(vaultEntry)
      .set({
        path: sql`${to} || substr(${vaultEntry.path}, char_length(${from}) + 1)`,
        projectId,
      })
      .where(pathOrBelow(from));
    const files = moved.filter((row) => row.kind !== 'folder');
    if (files.length > 0) {
      await tx.insert(vaultMove).values(
        files.map((row) => ({
          fromPath: row.path,
          toPath: to + row.path.slice(from.length),
          sha256: row.sha256,
        })),
      );
    }
  });
}

// The current path of a file a reference stored as (path, sha256): the path itself while
// it exists, else the recorded moves from it, else another file with the same content.
// Null when none of them leads to an indexed file.
export async function resolveVaultPath(
  relative: string,
  sha256: string | null = null,
): Promise<string | null> {
  let current = relative;
  const seen = new Set<string>();
  while (!seen.has(current) && seen.size < 20) {
    seen.add(current);
    if (await findEntry(current)) return current;
    const [move] = await db
      .select({ toPath: vaultMove.toPath })
      .from(vaultMove)
      .where(eq(vaultMove.fromPath, current))
      .orderBy(desc(vaultMove.movedAt), desc(vaultMove.id))
      .limit(1);
    if (!move) break;
    current = move.toPath;
  }
  if (!sha256) return null;
  const [same] = await db
    .select({ path: vaultEntry.path })
    .from(vaultEntry)
    .where(eq(vaultEntry.sha256, sha256))
    .orderBy(vaultEntry.id)
    .limit(1);
  return same?.path ?? null;
}

export async function pendingExtractions(limit: number): Promise<VaultEntryRow[]> {
  return db
    .select()
    .from(vaultEntry)
    .where(eq(vaultEntry.extractionStatus, 'pending'))
    .orderBy(vaultEntry.id)
    .limit(limit);
}

export async function unavailableExtractions(): Promise<VaultEntryRow[]> {
  return db.select().from(vaultEntry).where(eq(vaultEntry.extractionStatus, 'unavailable'));
}

// Stores an extraction result unless the file changed while it ran.
export async function saveExtraction(
  id: number,
  sha256: string | null,
  values: { text: string | null; status: VaultExtractionStatus; error: string | null },
): Promise<void> {
  await db
    .update(vaultEntry)
    .set({ text: values.text, extractionStatus: values.status, extractionError: values.error })
    .where(
      and(
        eq(vaultEntry.id, id),
        sha256 === null ? sql`${vaultEntry.sha256} IS NULL` : eq(vaultEntry.sha256, sha256),
      ),
    );
}

export async function requeueExtractions(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(vaultEntry)
    .set({ extractionStatus: 'pending', extractionError: null })
    .where(inArray(vaultEntry.id, ids));
}

export interface IndexedFileState {
  path: string;
  kind: VaultEntryKind;
  sizeBytes: number | null;
  mtime: Date | null;
}

export async function allIndexedFiles(): Promise<IndexedFileState[]> {
  return db
    .select({
      path: vaultEntry.path,
      kind: vaultEntry.kind,
      sizeBytes: vaultEntry.sizeBytes,
      mtime: vaultEntry.mtime,
    })
    .from(vaultEntry);
}
