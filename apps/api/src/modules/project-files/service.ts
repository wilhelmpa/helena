import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { HttpError } from '#shared/lib';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS = 500;
const DEFAULT_VAULT_ROOT = '/srv/volition/vault';

export function projectFilesSlug(projectKey: string): string {
  const key = projectKey.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(key)) throw new HttpError(400, 'Project key is invalid');
  return key;
}

function vaultRoot(): string {
  const root = path.resolve(process.env.PROJECT_VAULT_ROOT?.trim() || DEFAULT_VAULT_ROOT);
  if (!path.isAbsolute(root)) throw new HttpError(503, 'Project file storage is unavailable');
  return root;
}

function hasInvalidPathCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

function safeRelative(value = '', textOnly = false): string {
  if (typeof value !== 'string' || value.startsWith('/') || Buffer.byteLength(value) > 1024) {
    throw new HttpError(400, 'File path is invalid');
  }
  const parts = value ? value.split('/') : [];
  if (
    parts.length > 20 ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.length > 255 ||
        hasInvalidPathCharacter(part),
    )
  ) {
    throw new HttpError(400, 'File path is invalid');
  }
  const relative = parts.join('/');
  if (textOnly && (!relative || !TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase()))) {
    throw new HttpError(400, 'Only .txt, .md, and .markdown files are allowed');
  }
  return relative;
}

function projectRoot(projectKey: string): string {
  return path.join(vaultRoot(), 'Projects', projectFilesSlug(projectKey));
}

async function assertNoSymlinks(root: string, relative: string, allowMissing = false) {
  const segments = relative ? relative.split('/') : [];
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new HttpError(400, 'Symbolic links are not allowed');
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT' &&
        allowMissing
      ) {
        return;
      }
      throw error;
    }
  }
}

function targetPath(projectKey: string, relative: string): { root: string; target: string } {
  const root = projectRoot(projectKey);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep))
    throw new HttpError(400, 'File path is invalid');
  return { root, target };
}

function etag(bytes: Uint8Array): string {
  return `"${createHash('sha256').update(bytes).digest('base64url')}"`;
}

function mimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'text/markdown; charset=utf-8';
  if (extension === '.txt') return 'text/plain; charset=utf-8';
  if (extension === '.json') return 'application/json';
  if (extension === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

async function boundedFile(projectKey: string, relative: string, maximum: number) {
  const safe = safeRelative(relative);
  const { root, target } = targetPath(projectKey, safe);
  await assertNoSymlinks(root, safe);
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new HttpError(404, 'File not found');
    }
    throw error;
  }
  if (!info.isFile()) throw new HttpError(400, 'File path must refer to a file');
  if (info.size > maximum) throw new HttpError(413, 'File is too large');
  return { safe, target, info };
}

export async function listProjectFiles(projectKey: string, relative = '') {
  const safe = safeRelative(relative);
  const { root, target } = targetPath(projectKey, safe);
  await assertNoSymlinks(root, safe);
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new HttpError(404, 'Folder not found');
    }
    throw error;
  }
  if (entries.length > MAX_ITEMS) throw new HttpError(413, 'Folder contains too many entries');
  const items = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink()) return null;
      const child = path.join(target, entry.name);
      const info = await stat(child);
      const directory = info.isDirectory();
      return {
        name: entry.name,
        path: [safe, entry.name].filter(Boolean).join('/'),
        kind: directory ? ('folder' as const) : ('file' as const),
        sizeBytes: directory ? null : info.size,
        contentType: directory ? null : mimeType(entry.name),
        updatedAt: info.mtime.toISOString(),
        previewable: !directory && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      };
    }),
  );
  return {
    project: projectFilesSlug(projectKey),
    path: safe,
    items: items
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1,
      ),
  };
}

export async function readProjectText(projectKey: string, relative: string) {
  const safe = safeRelative(relative, true);
  const file = await boundedFile(projectKey, safe, MAX_TEXT_BYTES);
  const bytes = await readFile(file.target);
  return {
    project: projectFilesSlug(projectKey),
    path: safe,
    content: bytes.toString('utf8'),
    sizeBytes: bytes.length,
    etag: etag(bytes),
  };
}

export async function createProjectText(projectKey: string, relative: string, content: string) {
  const safe = safeRelative(relative, true);
  const bytes = Buffer.from(content);
  if (bytes.length > MAX_TEXT_BYTES) throw new HttpError(413, 'Text content is too large');
  const { root, target } = targetPath(projectKey, safe);
  await assertNoSymlinks(root, path.dirname(safe), true);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o770 });
  const handle = await open(target, 'wx', 0o660).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new HttpError(409, 'A file with this name already exists');
    }
    throw error;
  });
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  return { project: projectFilesSlug(projectKey), path: safe, created: true as const };
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

export function projectTextUpsertBody(
  projectKey: string,
  filePath: string,
  content: string,
  expectedEtag?: string | null,
) {
  return { project: projectFilesSlug(projectKey), path: filePath, content, expectedEtag };
}

export function projectFileDeleteBody(projectKey: string, filePath: string, expectedEtag?: string) {
  return { project: projectFilesSlug(projectKey), path: filePath, expectedEtag };
}

export async function upsertProjectText(
  projectKey: string,
  relative: string,
  content: string,
  expectedEtag?: string | null,
): Promise<ProjectTextUpsertResult> {
  const safe = safeRelative(relative, true);
  const bytes = Buffer.from(content);
  if (bytes.length > MAX_TEXT_BYTES) throw new HttpError(413, 'Text content is too large');
  const { root, target } = targetPath(projectKey, safe);
  await assertNoSymlinks(root, path.dirname(safe), true);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o770 });
  let current: Buffer | null = null;
  try {
    current = await readFile(target);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  if (expectedEtag === null && current !== null)
    throw new HttpError(409, 'File changed since it was read');
  if (typeof expectedEtag === 'string' && (current === null || etag(current) !== expectedEtag)) {
    throw new HttpError(409, 'File changed since it was read');
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  await open(temporary, 'wx', 0o660).then(async (handle) => {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
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

export async function deleteProjectFile(
  projectKey: string,
  relative: string,
  expectedEtag?: string,
): Promise<ProjectTextDeleteResult> {
  const safe = safeRelative(relative, true);
  const { root, target } = targetPath(projectKey, safe);
  await assertNoSymlinks(root, safe, true);
  let current;
  try {
    current = await readFile(target);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { project: projectFilesSlug(projectKey), path: safe, deleted: false };
    }
    throw error;
  }
  if (expectedEtag && etag(current) !== expectedEtag) {
    throw new HttpError(409, 'File changed since it was read');
  }
  await rm(target);
  return { project: projectFilesSlug(projectKey), path: safe, deleted: true };
}

export async function downloadProjectFile(projectKey: string, relative: string): Promise<Response> {
  const file = await boundedFile(projectKey, safeRelative(relative), MAX_DOWNLOAD_BYTES);
  const headers = new Headers({
    'Content-Type': mimeType(file.safe),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file.safe))}`,
    'Content-Length': String(file.info.size),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return new Response(Readable.toWeb(createReadStream(file.target)) as ReadableStream, { headers });
}
