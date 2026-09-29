import { createHash, randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { db, getDisplayName } from '@repo/db';
import { sql } from 'drizzle-orm';
import { isSyncConflict, moveEntries, splitNote } from '@repo/vault';
import { recordFileWrite, type FileActor } from './provenance';
import { HttpError } from '#shared/lib';
import {
  assertNoSymlinks,
  createSharedDirectory,
  ensureDirectory,
  errorCode,
  FILE_MODE,
  isMissing,
  joinPath,
  numberedName,
  parentPath,
  relativePath,
  resolveInside,
  safeFileName,
} from './paths';
import { fileSha256 } from './resolver';
import {
  projectFilesSlug,
  projectRoot,
  projectRootOf,
  homeRoot,
  vaultDirectory,
  type FileRoot,
} from './roots';
import { contentTypeOf, serveFile, VIEWER_INLINE } from './serve';

export { projectFilesSlug } from './roots';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.canvas', '.base']);
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_ITEMS = 1000;
const MAX_NAME_ATTEMPTS = 1000;

export interface FileItem {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  sizeBytes: number | null;
  contentType: string | null;
  updatedAt: string | null;
}

async function fileSystemError(error: unknown, notFound: string): Promise<never> {
  const code = errorCode(error);
  if (code === 'ENOENT') throw new HttpError(404, notFound);
  if (code === 'EACCES' || code === 'EPERM') {
    throw new HttpError(
      403,
      `${await getDisplayName()} has no access to this folder`,
      'not_readable',
    );
  }
  if (code === 'ENOTDIR') throw new HttpError(400, 'File path is invalid');
  throw error;
}

async function assertWritable(root: FileRoot) {
  if (!root.writable)
    throw new HttpError(403, `This folder is read-only in ${await getDisplayName()}`, 'read_only');
}

function textPath(relative: string): string {
  const safe = relativePath(relative);
  if (!safe || !TEXT_EXTENSIONS.has(path.extname(safe).toLowerCase())) {
    throw new HttpError(400, 'Only .txt, .md, .markdown, .canvas, and .base files are allowed');
  }
  return safe;
}

// The root folder itself, created on first write where Plan may create it.
async function rootDirectory(root: FileRoot): Promise<string> {
  if (root.creatable && root.vaultPath) return ensureDirectory(vaultDirectory(), root.vaultPath);
  try {
    if ((await stat(root.directory)).isDirectory()) return root.directory;
  } catch (error) {
    return await fileSystemError(error, 'Folder not found');
  }
  throw new HttpError(404, 'Folder not found');
}

async function folderDirectory(root: FileRoot, relative: string): Promise<string> {
  await rootDirectory(root);
  return ensureDirectory(root.directory, relative);
}

async function existingEntry(root: FileRoot, relative: string) {
  const target = resolveInside(root.directory, relative);
  try {
    if (root.vaultPath) await assertNoSymlinks(vaultDirectory(), root.vaultPath);
    await assertNoSymlinks(root.directory, relative);
    return { target, info: await lstat(target) };
  } catch (error) {
    return await fileSystemError(error, 'File not found');
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function listFolder(root: FileRoot, relative = '') {
  const safe = relativePath(relative);
  const target = resolveInside(root.directory, safe);
  let entries: Dirent[];
  try {
    if (root.vaultPath) await assertNoSymlinks(vaultDirectory(), root.vaultPath);
    await assertNoSymlinks(root.directory, safe);
    entries = await readdir(target, { withFileTypes: true });
  } catch (error) {
    // A root Plan creates on the first write is empty until then; a missing private
    // folder or workspace is reported as missing.
    if (!safe && root.creatable && isMissing(error)) entries = [];
    else return await fileSystemError(error, 'Folder not found');
  }
  // Hidden entries (.obsidian, .trash, .git) and Syncthing's conflict copies are not
  // the owner's documents.
  const visible = entries.filter(
    (entry) =>
      !entry.name.startsWith('.') &&
      !isSyncConflict(entry.name) &&
      (entry.isDirectory() || entry.isFile()),
  );
  const listed = await Promise.all(
    visible.slice(0, MAX_ITEMS).map(async (entry): Promise<FileItem | null> => {
      // An entry removed while the folder is read is left out.
      const info = await stat(path.join(target, entry.name)).catch(() => null);
      if (!info) return null;
      const folder = entry.isDirectory();
      return {
        name: entry.name,
        path: joinPath(safe, entry.name),
        kind: folder ? 'folder' : 'file',
        sizeBytes: folder ? null : info.size,
        contentType: folder ? null : contentTypeOf(entry.name),
        updatedAt: info.mtime.toISOString(),
      };
    }),
  );
  const items = listed.filter((item) => item !== null);
  return {
    root: root.name,
    path: safe,
    vaultPath: root.vaultPath === null ? null : joinPath(root.vaultPath, safe),
    absolutePath: target,
    writable: root.writable,
    truncated: visible.length > MAX_ITEMS,
    items: items.sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : a.kind === 'folder'
          ? -1
          : 1,
    ),
  };
}

export async function readTextFile(root: FileRoot, relative: string) {
  const safe = textPath(relative);
  const { target, info } = await existingEntry(root, safe);
  if (!info.isFile()) throw new HttpError(400, 'File path must refer to a file');
  if (info.size > MAX_TEXT_BYTES) throw new HttpError(413, 'File is too large');
  const bytes = await readFile(target);
  return {
    path: safe,
    content: bytes.toString('utf8'),
    sizeBytes: bytes.length,
    etag: etag(bytes),
  };
}

async function writeNewFile(target: string, bytes: Uint8Array) {
  const handle = await open(target, 'wx', FILE_MODE).catch((error: unknown) => {
    if (errorCode(error) === 'EEXIST')
      throw new HttpError(409, 'A file with this name already exists');
    throw error;
  });
  try {
    await handle.writeFile(bytes);
    await handle.chmod(FILE_MODE);
  } finally {
    await handle.close();
  }
}

function assertNotGeneratedContent(relative: string, bytes: Uint8Array): void {
  if (!relative.toLowerCase().endsWith('.md')) return;
  if (splitNote(Buffer.from(bytes).toString('utf8')).frontmatter.generated === true) {
    throw new HttpError(403, 'Generated notes are written by their DB export only');
  }
}

export async function createTextFile(
  root: FileRoot,
  relative: string,
  content: string,
  actor?: FileActor,
) {
  await assertWritable(root);
  const requested = textPath(relative);
  const safe = joinPath(parentPath(requested), safeFileName(path.basename(requested)));
  const bytes = Buffer.from(content);
  assertNotGeneratedContent(safe, bytes);
  if (bytes.length > MAX_TEXT_BYTES) throw new HttpError(413, 'Text content is too large');
  const directory = await folderDirectory(root, parentPath(safe));
  await writeNewFile(path.join(directory, path.basename(safe)), bytes);
  await recordFileWrite([joinPath(root.vaultPath!, safe)], actor);
  return { path: safe, created: true as const };
}

// Optimistic concurrency: the complete previous version is retained in the trash.
export async function updateTextFile(
  root: FileRoot,
  relative: string,
  content: string,
  expectedEtag: string,
  actor?: FileActor,
) {
  await assertWritable(root);
  const saved = await db.transaction(async (tx) => {
    // Serializes API writers across processes; a stale second save must conflict.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${root.directory + '/' + relativePath(relative)}, 0))`,
    );
    const current = await readTextFile(root, relative);
    await assertMutableProjection(path.join(root.directory, current.path));
    if (current.etag !== expectedEtag) throw new HttpError(409, 'File changed since it was read');
    const bytes = Buffer.from(content);
    assertNotGeneratedContent(current.path, bytes);
    if (bytes.length > MAX_TEXT_BYTES) throw new HttpError(413, 'Text content is too large');
    await replaceFileContents(root, current.path, bytes);
    return { path: current.path, content, sizeBytes: bytes.length, etag: etag(bytes) };
  });
  await recordFileWrite([joinPath(root.vaultPath!, saved.path)], actor);
  return saved;
}

export async function createFolder(root: FileRoot, relative: string) {
  await assertWritable(root);
  const requested = relativePath(relative);
  if (!requested) throw new HttpError(400, 'Folder name is required');
  const safe = joinPath(parentPath(requested), safeFileName(path.basename(requested), 'Folder'));
  const parent = await folderDirectory(root, parentPath(safe));
  const target = path.join(parent, path.basename(safe));
  try {
    await createSharedDirectory(target);
  } catch (error) {
    if (errorCode(error) === 'EEXIST')
      throw new HttpError(409, 'A folder with this name already exists');
    throw error;
  }
  return { path: safe };
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Writes the bytes under `name` in `folder`, or under "name (2)" and so on when the
// name is taken. The file is complete before it gets its name, and link(2) never
// replaces an existing file.
export async function writeUniqueFile(
  root: FileRoot,
  folder: string,
  name: string,
  bytes: Uint8Array,
  actor?: FileActor,
  options: { deferIndex?: boolean } = {},
): Promise<string> {
  await assertWritable(root);
  assertNotGeneratedContent(name, bytes);
  const directory = await folderDirectory(root, relativePath(folder));
  const temporary = path.join(directory, `.${randomUUID()}.part`);
  await writeNewFile(temporary, bytes);
  try {
    for (let number = 1; number <= MAX_NAME_ATTEMPTS; number += 1) {
      const candidate = numberedName(safeFileName(name), number);
      try {
        await link(temporary, path.join(directory, candidate));
        const relative = joinPath(folder, candidate);
        // Receipt intake owns a transaction and indexes the original after its commit.
        if (!options.deferIndex)
          await recordFileWrite([joinPath(root.vaultPath!, relative)], actor);
        return relative;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
    }
    throw new HttpError(409, 'No free file name is left in this folder');
  } finally {
    await unlink(temporary);
  }
}

export async function uploadFiles(
  root: FileRoot,
  folder: string,
  files: File[],
  maxBytes: number,
  actor?: FileActor,
): Promise<FileItem[]> {
  await assertWritable(root);
  const safeFolder = relativePath(folder);
  if (files.some((file) => file.size > maxBytes)) {
    throw new HttpError(413, `A file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
  }
  const items: FileItem[] = [];
  for (const file of files) {
    const created = await writeUniqueFile(
      root,
      safeFolder,
      file.name,
      new Uint8Array(await file.arrayBuffer()),
      actor,
    );
    items.push({
      name: path.basename(created),
      path: created,
      kind: 'file',
      sizeBytes: file.size,
      contentType: contentTypeOf(created),
      updatedAt: new Date().toISOString(),
    });
  }
  return items;
}

async function assertMutableProjection(target: string): Promise<void> {
  if (!target.toLowerCase().endsWith('.md')) return;
  const info = await stat(target);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) return;
  if (splitNote(await readFile(target, 'utf8')).frontmatter.generated === true) {
    throw new HttpError(403, 'Generated notes are read-only');
  }
}

export async function moveEntry(root: FileRoot, from: string, to: string, actor?: FileActor) {
  await assertWritable(root);
  const source = relativePath(from);
  const requested = relativePath(to);
  if (!source || !requested) throw new HttpError(400, 'File path is invalid');
  const destination = joinPath(parentPath(requested), safeFileName(path.basename(requested)));
  if (destination === source) return { path: source };
  if (destination.startsWith(`${source}/`)) {
    throw new HttpError(400, 'A folder cannot be moved into itself');
  }
  const { target } = await existingEntry(root, source);
  await assertMutableProjection(target);
  const parent = await existingEntry(root, parentPath(destination));
  if (!parent.info.isDirectory()) throw new HttpError(400, 'The target is not a folder');
  const next = path.join(parent.target, path.basename(destination));
  if (await exists(next)) throw new HttpError(409, 'An entry with this name already exists');
  await rename(target, next);
  if (root.vaultPath) {
    const before = joinPath(root.vaultPath, source);
    const after = joinPath(root.vaultPath, destination);
    try {
      await moveEntries(before, after);
    } catch (error) {
      await rename(next, target);
      throw error;
    }
    await recordFileWrite([before, after], actor);
  }
  return { path: destination };
}

// A free place in the trash of the root for `relative`: the same relative path, with a
// number when the name is taken there.
async function trashTarget(root: FileRoot, relative: string): Promise<string> {
  if (!root.trashPath) throw new HttpError(400, 'File path is invalid');
  const directory = await ensureDirectory(
    vaultDirectory(),
    joinPath(root.trashPath, parentPath(relative)),
  );
  for (let number = 1; number <= MAX_NAME_ATTEMPTS; number += 1) {
    const candidate = path.join(directory, numberedName(path.basename(relative), number));
    if (!(await exists(candidate))) return candidate;
  }
  throw new HttpError(409, 'No free name is left in the trash');
}

// Moves a file or folder to the trash of its root, keeping its relative path.
export async function trashEntry(
  root: FileRoot,
  relative: string,
  actor?: FileActor,
): Promise<void> {
  await assertWritable(root);
  const safe = relativePath(relative);
  if (!safe) throw new HttpError(400, 'File path is invalid');
  const { target } = await existingEntry(root, safe);
  await assertMutableProjection(target);
  await rename(target, await trashTarget(root, safe));
  await recordFileWrite([joinPath(root.vaultPath!, safe)], actor);
}

export async function fileResponse(
  root: FileRoot,
  relative: string,
  request: Request,
  download: boolean,
): Promise<Response> {
  const safe = relativePath(relative);
  const { target, info } = await existingEntry(root, safe);
  if (!info.isFile()) throw new HttpError(400, 'File path must refer to a file');
  const filename = path.basename(safe);
  return serveFile({
    file: target,
    filename,
    contentType: contentTypeOf(filename),
    request,
    download,
    inline: VIEWER_INLINE,
  });
}

// The vault file an attachment links to, with what the attachment row records of it.
export async function describeVaultFile(root: FileRoot, relative: string) {
  const safe = relativePath(relative);
  const { target, info } = await existingEntry(root, safe);
  if (!info.isFile() || !root.vaultPath) throw new HttpError(400, 'File path must refer to a file');
  return {
    vaultPath: joinPath(root.vaultPath, safe),
    name: path.basename(safe),
    contentType: contentTypeOf(safe),
    sizeBytes: info.size,
    sha256: await fileSha256(target),
  };
}

// A vault file a chat message refers to: what the message keeps of it, without reading
// the file.
export async function statVaultFile(root: FileRoot, relative: string) {
  const safe = relativePath(relative);
  const { info } = await existingEntry(root, safe);
  if (!info.isFile() || !root.vaultPath) throw new HttpError(400, 'File path must refer to a file');
  return {
    vaultPath: joinPath(root.vaultPath, safe),
    name: path.basename(safe),
    contentType: contentTypeOf(safe),
    sizeBytes: info.size,
  };
}

function vaultEntry(vaultPath: string) {
  const safe = relativePath(vaultPath);
  const [top, ...rest] = safe.split('/');
  const home =
    top === 'Home'
      ? 'home'
      : top === 'Private'
        ? 'private'
        : top === 'Templates'
          ? 'templates'
          : null;
  const entry = home ? { root: homeRoot(home), relative: rest.join('/') } : projectRootOf(safe);
  if (!entry?.relative) throw new HttpError(400, 'File path is invalid');
  return entry;
}

export async function serveVaultFile(input: {
  vaultPath: string;
  filename: string;
  contentType: string;
  request: Request;
  download: boolean;
  inline: (contentType: string) => boolean;
}): Promise<Response> {
  const { root, relative } = vaultEntry(input.vaultPath);
  const { target, info } = await existingEntry(root, relative);
  if (!info.isFile()) throw new HttpError(404, 'File not found');
  return serveFile({ ...input, file: target });
}

export async function trashVaultFile(vaultPath: string): Promise<void> {
  const { root, relative } = vaultEntry(vaultPath);
  await trashEntry(root, relative);
}

// Writes new bytes to a vault file in place, so every link to it keeps working. The
// previous version is kept in the trash.
export async function replaceVaultFile(
  vaultPath: string,
  bytes: Uint8Array,
  actor?: FileActor,
): Promise<void> {
  const { root, relative } = vaultEntry(vaultPath);
  await replaceFileContents(root, relative, bytes);
  await recordFileWrite([vaultPath], actor);
}

async function replaceFileContents(root: FileRoot, relative: string, bytes: Uint8Array) {
  const { target, info } = await existingEntry(root, relative);
  if (!info.isFile()) throw new HttpError(400, 'File path must refer to a file');
  await copyFile(target, await trashTarget(root, relative), constants.COPYFILE_EXCL);
  const temporary = path.join(path.dirname(target), `.${randomUUID()}.part`);
  await writeNewFile(temporary, bytes);
  await rename(temporary, target);
}

// Markdown export of the Docs (documents/markdown-sync.ts): one text file per document,
// written with an ETag check so an edit made in the vault is not overwritten unseen.

function etag(bytes: Uint8Array): string {
  return `"${createHash('sha256').update(bytes).digest('base64url')}"`;
}

export async function readProjectText(projectKey: string, relative: string) {
  const text = await readTextFile(projectRoot(projectKey), relative);
  return { project: projectFilesSlug(projectKey), ...text };
}

export interface ProjectTextUpsertResult {
  project: string;
  path: string;
  created: boolean;
  etag: string;
}

export interface ProjectTextDeleteResult {
  project: string;
  path: string;
  deleted: boolean;
}

export async function upsertProjectText(
  projectKey: string,
  relative: string,
  content: string,
  expectedEtag?: string | null,
): Promise<ProjectTextUpsertResult> {
  const root = projectRoot(projectKey);
  const safe = textPath(relative);
  const bytes = Buffer.from(content);
  assertNotGeneratedContent(safe, bytes);
  if (bytes.length > MAX_TEXT_BYTES) throw new HttpError(413, 'Text content is too large');
  await assertNoSymlinks(root.directory, safe, true);
  const target = path.join(await folderDirectory(root, parentPath(safe)), path.basename(safe));
  let current: Buffer | null = null;
  try {
    current = await readFile(target);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (current !== null) await assertMutableProjection(target);
  if (expectedEtag === null && current !== null)
    throw new HttpError(409, 'File changed since it was read');
  if (typeof expectedEtag === 'string' && (current === null || etag(current) !== expectedEtag)) {
    throw new HttpError(409, 'File changed since it was read');
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeNewFile(temporary, bytes);
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return {
    project: projectFilesSlug(projectKey),
    path: safe,
    created: current === null,
    etag: etag(bytes),
  };
}

// A document that turned private is removed from the shared folder for good: the
// vault trash is readable by the agents as well.
export async function deleteProjectFile(
  projectKey: string,
  relative: string,
  expectedEtag?: string,
): Promise<ProjectTextDeleteResult> {
  const root = projectRoot(projectKey);
  const safe = textPath(relative);
  const target = resolveInside(root.directory, safe);
  await assertNoSymlinks(root.directory, safe, true);
  let current;
  try {
    current = await readFile(target);
  } catch (error) {
    if (isMissing(error))
      return { project: projectFilesSlug(projectKey), path: safe, deleted: false };
    throw error;
  }
  await assertMutableProjection(target);
  if (expectedEtag && etag(current) !== expectedEtag) {
    throw new HttpError(409, 'File changed since it was read');
  }
  await rm(target);
  return { project: projectFilesSlug(projectKey), path: safe, deleted: true };
}
