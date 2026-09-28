import { createReadStream } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db, vaultEntry, vaultLink } from '@repo/db';
import { mimeFromName } from '@repo/storage/mime';
import {
  absoluteVaultPath,
  assertNoSymlink,
  baseName,
  commitVaultPaths,
  composeNote,
  createVaultFolder,
  fileAtRevision,
  fileHistory,
  findEntry,
  indexVaultPaths,
  isIgnoredPath,
  isNotePath,
  joinVaultPath,
  listSyncConflicts,
  listTrash,
  locateVaultPath,
  MAX_NOTE_BYTES,
  moveEntries,
  moveVaultPath,
  normalizeVaultPath,
  noteTitle,
  parentPath,
  pathOrBelow,
  readVaultFile,
  resolveVaultPath,
  restoreVaultPath,
  splitNote,
  TASK_IDENTIFIER,
  trashVaultPath,
  VaultError,
  walkVault,
  writeVaultFile,
  type Frontmatter,
} from '@repo/vault';
import { reindexVaultPaths } from '@helena/knowledge';
import { HttpError, iso } from '#shared/lib';
import { attachmentResponseHeaders, safeAttachmentFilename } from '#modules/attachments/storage';
import { canAccess, readableEntries, type VaultScope } from './scope';

const MAX_TREE_ITEMS = 5000;
const MAX_FOLDER_ITEMS = 1000;
const DEFAULT_MAX_CHARS = 200_000;
const MAX_ASSET_BYTES = 50 * 1024 * 1024;

// The vault reports expected failures as VaultError; the routes answer them as the
// HTTP error of the same status.
export async function vaultCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VaultError) throw new HttpError(error.status, error.message, error.code);
    throw error;
  }
}

function projectKeyOf(relative: string): string | null {
  return locateVaultPath(relative).projectKey;
}

function cut(text: string, maxChars: number): { text: string; truncated: boolean } {
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false };
}

export async function readDocument(relative: string, maxChars = DEFAULT_MAX_CHARS) {
  if (isNotePath(relative)) {
    const file = await readVaultFile(relative, MAX_NOTE_BYTES);
    const content = file.bytes.toString('utf8');
    const note = splitNote(content);
    const whole = cut(content, maxChars);
    const body = cut(note.body, maxChars);
    return {
      path: relative,
      kind: 'note' as const,
      title: noteTitle(note.frontmatter, relative),
      mime: 'text/markdown',
      sizeBytes: file.bytes.length,
      sha256: file.sha256,
      updatedAt: file.mtime.toISOString(),
      projectKey: projectKeyOf(relative),
      content: whole.text,
      frontmatter: note.frontmatter,
      body: body.text,
      truncated: whole.truncated,
      extractionStatus: 'none',
      absolutePath: absoluteVaultPath(relative),
    };
  }
  await assertNoSymlink(relative);
  let info;
  try {
    info = await lstat(absoluteVaultPath(relative));
  } catch {
    throw new HttpError(404, 'File not found');
  }
  if (!info.isFile()) throw new HttpError(400, 'Path is not a file');
  let entry = await findEntry(relative);
  if (!entry || entry.sizeBytes !== info.size) {
    await indexVaultPaths([relative]);
    entry = await findEntry(relative);
  }
  if (!entry) throw new HttpError(404, 'File not found');
  const text = cut(entry.text ?? '', maxChars);
  return {
    path: relative,
    kind: 'file' as const,
    title: entry.title,
    mime: entry.mime ?? mimeFromName(relative),
    sizeBytes: info.size,
    sha256: entry.sha256 ?? '',
    updatedAt: info.mtime.toISOString(),
    projectKey: projectKeyOf(relative),
    content: text.text,
    frontmatter: {},
    body: text.text,
    truncated: text.truncated,
    extractionStatus: entry.extractionStatus,
    absolutePath: absoluteVaultPath(relative),
  };
}

// The knowledge index follows a write right away; a failure there never fails the write
// (the worker's catch-up brings it in).
export async function reindexVaultItems(paths: string[]): Promise<void> {
  try {
    await reindexVaultPaths(paths);
  } catch (error) {
    console.error('[knowledge] reindexing after a write failed:', error);
  }
}

// The note after the write, and the commit that records it. The index is updated
// right away, so the Docs tree, search and backlinks show the change before the
// watcher sees it.
//
// The index records who wrote it (and in which run), the commit carries the same as git
// trailers, and the knowledge index takes the change in at once, so the search (⌘K and
// the agents' search_knowledge) finds it before the worker's next catch-up.
async function recordWrite(
  paths: string[],
  message: string,
  scope: VaultScope,
  options: { continueSession?: boolean } = {},
): Promise<void> {
  const { actor } = scope;
  await indexVaultPaths(paths, { author: actor.ref, runId: actor.runId });
  await commitVaultPaths(paths, message, scope.author, {
    ...options,
    trailers: {
      'Helena-Actor': actor.ref,
      ...(actor.runId ? { 'Helena-Run': String(actor.runId) } : {}),
    },
  });
  await reindexVaultItems(paths);
}

export async function writeNote(
  scope: VaultScope,
  input: {
    path: string;
    content?: string;
    body?: string;
    frontmatter?: Frontmatter;
    expectedSha?: string | null;
  },
) {
  if (!isNotePath(input.path)) throw new HttpError(400, 'A note path ends in ".md"');
  const expectedSha = input.expectedSha ?? null;
  let content: string;
  if (input.content !== undefined) {
    content = input.content;
  } else if (input.body !== undefined) {
    let raw: string | null = null;
    let current: Frontmatter = {};
    if (expectedSha !== null) {
      const existing = await readVaultFile(input.path, MAX_NOTE_BYTES).catch(() => null);
      if (existing) {
        const parts = splitNote(existing.bytes.toString('utf8'));
        raw = parts.frontmatterRaw;
        current = parts.frontmatter;
      }
    }
    content = composeNote(input.frontmatter ?? current, input.body, raw);
  } else {
    throw new HttpError(400, 'Send the note as `content`, or as `body` with `frontmatter`');
  }
  const bytes = Buffer.from(content);
  if (bytes.length > MAX_NOTE_BYTES) throw new HttpError(413, 'The note is too large');
  const result = await writeVaultFile(input.path, bytes, expectedSha);
  await recordWrite([input.path], `${result.created ? 'Create' : 'Update'} ${input.path}`, scope, {
    continueSession: true,
  });
  return {
    path: input.path,
    sha256: result.sha256,
    created: result.created,
    title: noteTitle(splitNote(content).frontmatter, input.path),
  };
}

async function titlesBelow(folder: string) {
  const rows = await db
    .select({ path: vaultEntry.path, title: vaultEntry.title, mtime: vaultEntry.mtime })
    .from(vaultEntry)
    .where(pathOrBelow(folder));
  return new Map(rows.map((row) => [row.path, row]));
}

// The notes and folders below a Docs root, read from disk, with their titles from the
// index. Sorted by path, so a client builds the tree in one pass.
export async function listTree(scope: VaultScope, root: string) {
  await assertNoSymlink(root);
  const paths = (await walkVault(root)).filter(
    (relative) => canAccess(scope, relative, 'read') && !isIgnoredPath(relative),
  );
  if (paths.length > MAX_TREE_ITEMS) throw new HttpError(413, 'The folder holds too many files');
  const indexed = await titlesBelow(root);
  const items = [];
  for (const relative of paths.sort()) {
    const note = isNotePath(relative);
    const row = indexed.get(relative);
    if (!note) {
      const info = await lstat(absoluteVaultPath(relative)).catch(() => null);
      if (!info?.isDirectory()) continue;
    }
    items.push({
      path: relative,
      name: baseName(relative),
      kind: note ? ('note' as const) : ('folder' as const),
      title: row?.title || baseName(relative).replace(/\.md$/i, ''),
      updatedAt: row?.mtime ? iso(row.mtime) : null,
    });
  }
  return { root, items };
}

// The files below a folder, newest first (Wissen "Zuletzt geändert"): notes and every
// other file across all subfolders, read from disk, with their titles from the index.
const MAX_RECENT_SCAN = 20_000;
export async function listRecent(scope: VaultScope, root: string, limit: number) {
  await assertNoSymlink(root);
  const paths = (await walkVault(root))
    .filter((relative) => canAccess(scope, relative, 'read') && !isIgnoredPath(relative))
    .slice(0, MAX_RECENT_SCAN);
  const files: { relative: string; size: number; mtime: Date }[] = [];
  for (let start = 0; start < paths.length; start += 200) {
    const chunk = paths.slice(start, start + 200);
    const infos = await Promise.all(
      chunk.map((relative) => lstat(absoluteVaultPath(relative)).catch(() => null)),
    );
    infos.forEach((info, index) => {
      if (info?.isFile())
        files.push({ relative: chunk[index]!, size: info.size, mtime: info.mtime });
    });
  }
  files.sort(
    (a, b) => b.mtime.getTime() - a.mtime.getTime() || a.relative.localeCompare(b.relative),
  );
  const shown = files.slice(0, limit);
  const indexed = await titlesBelow(root);
  return {
    root,
    items: shown.map(({ relative, size, mtime }) => ({
      path: relative,
      name: baseName(relative),
      kind: isNotePath(relative) ? ('note' as const) : ('file' as const),
      title: indexed.get(relative)?.title || baseName(relative).replace(/\.md$/i, ''),
      mime: mimeFromName(relative),
      sizeBytes: size,
      updatedAt: iso(mtime),
    })),
  };
}

export async function listFolder(scope: VaultScope, folder: string) {
  await assertNoSymlink(folder);
  let entries;
  try {
    entries = await readdir(absoluteVaultPath(folder), { withFileTypes: true });
  } catch {
    throw new HttpError(404, 'Folder not found');
  }
  const visible = entries.filter((entry) => {
    const relative = joinVaultPath(folder, entry.name);
    return (
      !entry.isSymbolicLink() &&
      !entry.name.startsWith('.') &&
      !isIgnoredPath(relative) &&
      canAccess(scope, relative, 'read')
    );
  });
  if (visible.length > MAX_FOLDER_ITEMS)
    throw new HttpError(413, 'The folder holds too many files');
  const paths = visible.map((entry) => joinVaultPath(folder, entry.name));
  const rows =
    paths.length > 0
      ? await db.select().from(vaultEntry).where(inArray(vaultEntry.path, paths))
      : [];
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const listed = await Promise.all(
    visible.map(async (entry) => {
      const relative = joinVaultPath(folder, entry.name);
      // Gone since the folder was read.
      const info = await stat(absoluteVaultPath(relative)).catch(() => null);
      if (!info) return null;
      const row = byPath.get(relative);
      const kind = info.isDirectory()
        ? ('folder' as const)
        : isNotePath(relative)
          ? ('note' as const)
          : ('file' as const);
      return {
        path: relative,
        name: entry.name,
        kind,
        title: row?.title || entry.name.replace(/\.md$/i, ''),
        mime: kind === 'folder' ? null : mimeFromName(relative),
        sizeBytes: kind === 'folder' ? null : info.size,
        updatedAt: info.mtime.toISOString(),
        extractionStatus: row?.extractionStatus ?? null,
      };
    }),
  );
  const items = listed.filter((item) => item !== null);
  items.sort((a, b) =>
    a.kind === 'folder' && b.kind !== 'folder'
      ? -1
      : b.kind === 'folder' && a.kind !== 'folder'
        ? 1
        : a.name.localeCompare(b.name),
  );
  return { path: folder, items };
}

// The words of a query as a prefix query for the simple configuration, so a search
// finds a word while it is still being typed. Letters and digits only, which leaves
// nothing to escape.
function prefixQuery(q: string): string | null {
  const words =
    q
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 8) ?? [];
  return words.length > 0 ? words.map((word) => `${word}:*`).join(' & ') : null;
}

// Ranked full text over notes and the extracted text of files, with a short excerpt
// around the matches. German stemming and plain words both count.
export async function searchKnowledge(
  scope: VaultScope,
  input: { q: string; folder?: string; limit: number },
) {
  const prefix = prefixQuery(input.q);
  const query = prefix
    ? sql`(websearch_to_tsquery('german', ${input.q}) || to_tsquery('simple', ${prefix}))`
    : sql`websearch_to_tsquery('german', ${input.q})`;
  const conditions = [
    readableEntries(scope),
    ne(vaultEntry.kind, 'folder'),
    sql`${vaultEntry.search} @@ ${query}`,
  ];
  if (input.folder) conditions.push(pathOrBelow(input.folder));
  const rank = sql<number>`ts_rank_cd(${vaultEntry.search}, ${query})`;
  const ranked = db
    .select({ id: vaultEntry.id, rank: rank.as('rank') })
    .from(vaultEntry)
    .where(and(...conditions))
    .orderBy(sql`rank desc`, asc(vaultEntry.path))
    .limit(input.limit)
    .as('ranked');
  const rows = await db
    .select({
      path: vaultEntry.path,
      title: vaultEntry.title,
      kind: vaultEntry.kind,
      mtime: vaultEntry.mtime,
      rank: ranked.rank,
      snippet: sql<string>`ts_headline('german', left(coalesce(${vaultEntry.text}, ''), 100000), ${query}, 'MaxFragments=2, MaxWords=24, MinWords=8, FragmentDelimiter=" … ", StartSel=**, StopSel=**')`,
    })
    .from(ranked)
    .innerJoin(vaultEntry, eq(vaultEntry.id, ranked.id))
    .orderBy(sql`${ranked.rank} desc`, asc(vaultEntry.path));
  return {
    items: rows.map((row) => ({
      path: row.path,
      title: row.title,
      kind: row.kind,
      projectKey: projectKeyOf(row.path),
      snippet: row.snippet.trim(),
      rank: Number(row.rank),
      updatedAt: row.mtime ? iso(row.mtime) : null,
    })),
  };
}

// The name a link uses for an entry: a note's path without ".md", any other file's
// full path. A link target matches when it equals that name or ends it after a "/".
function linkName(relative: string): string {
  return isNotePath(relative) ? relative.replace(/\.md$/i, '') : relative;
}

function targetMatches(name: string) {
  return or(
    sql`lower(${vaultLink.target}) = lower(${name})`,
    sql`right(lower(${'/' + name}), char_length(${vaultLink.target}) + 1) = '/' || lower(${vaultLink.target})`,
  )!;
}

async function linkingNotes(scope: VaultScope, condition: ReturnType<typeof and>) {
  const rows = await db
    .selectDistinct({ path: vaultEntry.path, title: vaultEntry.title, mtime: vaultEntry.mtime })
    .from(vaultLink)
    .innerJoin(vaultEntry, eq(vaultEntry.id, vaultLink.entryId))
    .where(and(condition, readableEntries(scope)))
    .orderBy(asc(vaultEntry.title), asc(vaultEntry.path));
  return rows.map((row) => ({
    path: row.path,
    title: row.title,
    projectKey: projectKeyOf(row.path),
    updatedAt: row.mtime ? iso(row.mtime) : null,
  }));
}

// The notes that link to a note or file.
export function backlinksToPath(scope: VaultScope, relative: string) {
  return linkingNotes(
    scope,
    and(
      eq(vaultLink.kind, 'note'),
      targetMatches(linkName(relative)),
      ne(vaultEntry.path, relative),
    ),
  );
}

// The notes that link to a task with [[KEY-n]].
export function backlinksToTask(scope: VaultScope, identifier: string) {
  return linkingNotes(scope, and(eq(vaultLink.kind, 'task'), eq(vaultLink.target, identifier)));
}

// The file a wikilink in a note points to, the way the notes and other Markdown editors
// pick it: the entry whose name matches, preferring one in the note's own folder, then in
// its project, then the shortest path.
export async function resolveWikilink(scope: VaultScope, from: string, target: string) {
  const name = target.split('|')[0].split('#')[0].trim().replace(/\.md$/i, '');
  if (!name || TASK_IDENTIFIER.test(name)) return { path: null };
  const stem = sql`(case when ${vaultEntry.kind} = 'note' then regexp_replace(${vaultEntry.path}, '\\.md$', '', 'i') else ${vaultEntry.path} end)`;
  const rows = await db
    .select({ path: vaultEntry.path })
    .from(vaultEntry)
    .where(
      and(
        ne(vaultEntry.kind, 'folder'),
        readableEntries(scope),
        or(
          sql`lower(${stem}) = lower(${name})`,
          sql`right(lower('/' || ${stem}), char_length(${name}) + 1) = '/' || lower(${name})`,
        ),
      ),
    )
    .limit(50);
  const folder = parentPath(from);
  const project = projectKeyOf(from);
  const score = (relative: string) =>
    (parentPath(relative) === folder ? 0 : projectKeyOf(relative) === project ? 1 : 2) * 10_000 +
    relative.length;
  const best = rows.map((row) => row.path).sort((a, b) => score(a) - score(b))[0];
  return { path: best ?? null };
}

export async function resolvePath(scope: VaultScope, relative: string, sha256?: string) {
  const current = await resolveVaultPath(normalizeVaultPath(relative), sha256 ?? null);
  return { path: current && canAccess(scope, current, 'read') ? current : null };
}

export async function createFolder(relative: string) {
  await createVaultFolder(relative);
  await indexVaultPaths([relative]);
  return { path: relative };
}

export async function movePath(scope: VaultScope, from: string, to: string) {
  if (isNotePath(from) !== isNotePath(to)) {
    throw new HttpError(400, 'A note keeps the ".md" ending when it is renamed');
  }
  await moveVaultPath(from, to);
  try {
    await moveEntries(from, to);
  } catch (error) {
    await moveVaultPath(to, from);
    throw error;
  }
  await recordWrite([from, to], `Move ${from} to ${to}`, scope);
  return { path: to };
}

export async function trashPath(scope: VaultScope, relative: string) {
  await trashVaultPath(relative);
  await recordWrite([relative], `Trash ${relative}`, scope);
  return { path: relative };
}

export async function restorePath(scope: VaultScope, relative: string) {
  await restoreVaultPath(relative);
  await recordWrite([relative], `Restore ${relative}`, scope);
  return { path: relative };
}

export async function listTrashed(root: string) {
  return (await listTrash(root)).map((item) => ({
    path: item.path,
    trashedAt: iso(item.trashedAt),
  }));
}

// The Syncthing conflict copies below a Docs root: two devices changed a note at the
// same time, and the owner decides which version stays.
export async function listConflicts(scope: VaultScope, root: string) {
  await assertNoSymlink(root);
  return (await listSyncConflicts(root))
    .filter((conflict) => canAccess(scope, conflict.path, 'read'))
    .map((conflict) => ({
      path: conflict.path,
      original: conflict.original,
      updatedAt: iso(conflict.updatedAt),
    }));
}

export async function noteHistory(relative: string) {
  return (await fileHistory(relative)).map((revision) => ({
    commit: revision.commit,
    authorName: revision.authorName,
    committedAt: revision.committedAt,
    message: revision.message,
  }));
}

export async function noteVersion(relative: string, commit: string) {
  const content = await fileAtRevision(relative, commit);
  if (content === null) throw new HttpError(404, 'This version does not exist');
  return { path: relative, commit, content };
}

export async function rawFile(relative: string, request: Request, download: boolean) {
  await assertNoSymlink(relative);
  let info;
  try {
    info = await lstat(absoluteVaultPath(relative));
  } catch {
    throw new HttpError(404, 'File not found');
  }
  if (!info.isFile()) throw new HttpError(400, 'Path is not a file');
  const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(
    Readable.toWeb(createReadStream(absoluteVaultPath(relative))) as ReadableStream,
    {
      headers: attachmentResponseHeaders({
        contentType: mimeFromName(relative),
        filename: baseName(relative),
        contentLength: info.size,
        etag,
        download,
      }),
    },
  );
}

// Images inserted into a note live beside that note, under a name not taken yet.
export async function uploadAsset(scope: VaultScope, notePath: string, file: File) {
  if (file.size === 0) throw new HttpError(400, 'File is empty');
  if (file.size > MAX_ASSET_BYTES) throw new HttpError(413, 'File is too large');
  const folder = parentPath(notePath);
  if (!canAccess(scope, folder, 'write')) throw new HttpError(403, 'You cannot add files here');
  const name = safeAttachmentFilename(file.name).replace(/^\.+/, '').slice(-120) || 'file';
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  const bytes = Buffer.from(await file.arrayBuffer());
  for (let number = 1; number < 1000; number += 1) {
    const candidate = joinVaultPath(folder, number === 1 ? name : `${stem} ${number}${extension}`);
    try {
      await writeVaultFile(candidate, bytes, null);
    } catch (error) {
      if (error instanceof VaultError && error.code === 'exists') continue;
      throw error;
    }
    await recordWrite([candidate], `Add ${candidate}`, scope);
    return { path: candidate };
  }
  throw new HttpError(409, 'Too many files with this name');
}
