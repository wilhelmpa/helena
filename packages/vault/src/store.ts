import { and, desc, eq, inArray, isNull, like, ne, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  db,
  project,
  vaultEntry,
  vaultLink,
  vaultMove,
  type VaultEntryKind,
  type VaultExtractionStatus,
  escapeLike,
  issue,
  issueAttachment,
  chatAttachment,
  initiative,
  initiativeAttachment,
  helenaReceipt,
  mailAttachment,
  mailMessage,
  mailThread,
  agentChatMessage,
  agentChatThread,
  noteBoard,
  helenaBrowserTaskRun,
} from '@repo/db';
import { noteTitle, type Frontmatter, type NoteLink } from './markdown';
import { baseName, isNotePath, locateVaultPath } from './paths';

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
  // Who made this version, when the caller knows (see vault_entry.last_author). Left
  // out, the row keeps what it had.
  lastAuthor?: string | null;
  lastRunId?: number | null;
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

export async function touchEntry(
  id: number,
  mtime: Date,
  sizeBytes: number,
  provenance?: { author: string; runId?: number | null },
): Promise<void> {
  await db
    .update(vaultEntry)
    .set({
      mtime,
      sizeBytes,
      indexedAt: new Date(),
      ...(provenance ? { lastAuthor: provenance.author, lastRunId: provenance.runId ?? null } : {}),
    })
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

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function moveFileReferences(
  tx: Transaction,
  from: string,
  to: string,
  projectId: number | null,
) {
  const root = (value: string) =>
    value
      .split('/')
      .slice(0, value.startsWith('Projects/') ? 2 : 1)
      .join('/');
  // Moving a physical file across roots must not transfer another project's access.
  if (root(from) !== root(to) || (from.startsWith('Projects/') && projectId === null)) return;
  const scope = (column: AnyPgColumn) =>
    projectId === null ? isNull(column) : eq(column, projectId);
  const matches = (column: AnyPgColumn) =>
    or(
      eq(column, from),
      sql`left(${column}, char_length(${from}::text) + 1) = ${from}::text || '/'`,
    );
  const issues = tx.select({ id: issue.id }).from(issue).where(scope(issue.projectId));
  const initiatives = tx
    .select({ id: initiative.id })
    .from(initiative)
    .where(scope(initiative.projectId));
  const threads = tx
    .select({ id: mailThread.id })
    .from(mailThread)
    .where(scope(mailThread.projectId));
  const messages = tx
    .select({ id: mailMessage.id })
    .from(mailMessage)
    .where(inArray(mailMessage.threadId, threads));
  for (const { table, owner } of [
    { table: issueAttachment, owner: inArray(issueAttachment.issueId, issues) },
    { table: chatAttachment, owner: scope(chatAttachment.projectId) },
    { table: initiativeAttachment, owner: inArray(initiativeAttachment.initiativeId, initiatives) },
    { table: helenaReceipt, owner: scope(helenaReceipt.projectId) },
    { table: mailAttachment, owner: inArray(mailAttachment.messageId, messages) },
  ]) {
    await tx
      .update(table)
      .set({
        vaultPath: sql`${to}::text || substr(${table.vaultPath}, char_length(${from}::text) + 1)`,
      })
      .where(and(owner, matches(table.vaultPath)));
  }
  await tx
    .update(noteBoard)
    .set({
      vaultPath: sql`${to}::text || substr(${noteBoard.vaultPath}, char_length(${from}::text) + 1)`,
    })
    .where(and(scope(noteBoard.projectId), matches(noteBoard.vaultPath)));
  await tx
    .update(helenaBrowserTaskRun)
    .set({
      finalFramePath: sql`${to}::text || substr(${helenaBrowserTaskRun.finalFramePath}, char_length(${from}::text) + 1)`,
    })
    .where(matches(helenaBrowserTaskRun.finalFramePath));
  const chats = tx
    .select({ id: agentChatThread.id })
    .from(agentChatThread)
    .where(
      /^(Home|Templates)\//.test(from)
        ? undefined
        : or(scope(agentChatThread.projectId), isNull(agentChatThread.projectId)),
    );
  const fileMatch = sql`item->>'kind' = 'file' AND (
    item->>'path' = ${from} OR left(item->>'path', char_length(${from}::text) + 1) = ${from}::text || '/'
  )`;
  const fileItems = sql`CASE WHEN jsonb_typeof(${agentChatMessage.attachments}) = 'array'
    THEN ${agentChatMessage.attachments} ELSE '[]'::jsonb END`;
  await tx
    .update(agentChatMessage)
    .set({
      attachments: sql`(SELECT jsonb_agg(CASE WHEN ${fileMatch}
        THEN jsonb_set(item, '{path}', to_jsonb(${to}::text || substr(item->>'path', char_length(${from}::text) + 1)))
        ELSE item END ORDER BY ordinal)
        FROM jsonb_array_elements(${fileItems}) WITH ORDINALITY AS entries(item, ordinal))`,
    })
    .where(
      and(
        inArray(agentChatMessage.threadId, chats),
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${fileItems}) AS item WHERE ${fileMatch})`,
      ),
    );
  await tx
    .update(mailMessage)
    .set({
      attachmentFolder: sql`${to}::text || substr(${mailMessage.attachmentFolder}, char_length(${from}::text) + 1)`,
    })
    .where(and(inArray(mailMessage.threadId, threads), matches(mailMessage.attachmentFolder)));
}

// Moves index rows from one path to another: the path itself and, for a folder, all it
// holds. The rows keep their id, so the links they make and the links to them stay. Each
// moved file is recorded for the resolver.
export async function moveEntries(from: string, to: string): Promise<void> {
  const projectId = await projectIdForPath(to);
  await db.transaction(async (tx) => {
    await moveFileReferences(tx, from, to, projectId);
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
    // A title follows the name unless a note's frontmatter sets one. The file itself
    // is unchanged (same size and time), so the indexer would not look at it again and
    // the tree kept showing the old name.
    const renamed = await tx
      .select({
        id: vaultEntry.id,
        path: vaultEntry.path,
        title: vaultEntry.title,
        frontmatter: vaultEntry.frontmatter,
      })
      .from(vaultEntry)
      .where(pathOrBelow(to));
    for (const row of renamed) {
      const title = isNotePath(row.path)
        ? noteTitle(row.frontmatter, row.path)
        : baseName(row.path);
      if (title !== row.title) {
        await tx.update(vaultEntry).set({ title }).where(eq(vaultEntry.id, row.id));
      }
    }
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
  // indexed_at moves too, so the knowledge index picks the new text up.
  await db
    .update(vaultEntry)
    .set({
      text: values.text,
      extractionStatus: values.status,
      extractionError: values.error,
      indexedAt: new Date(),
    })
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
