import { chmod, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '#shared/lib';

const MAX_PATH_BYTES = 1024;
const MAX_DEPTH = 20;
const MAX_NAME_BYTES = 200;

// Directories and files are shared with the agents and the other vault writers through
// the group, whatever the umask of the process is.
export const DIRECTORY_MODE = 0o2770;
export const FILE_MODE = 0o660;

export function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}

export const isMissing = (error: unknown) => errorCode(error) === 'ENOENT';

const isControl = (code: number) => code <= 0x1f || code === 0x7f;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (isControl(code) || code === 0x5c) return true;
  }
  return false;
}

// A path below a file root, as the client sends it: segments joined by "/", no
// leading slash, no "." or "..". The empty path is the root itself. A segment starting
// with a dot is refused as well: hidden entries (.env, .git, .trash, .obsidian) are not
// listed, and they are not reachable by name either.
export function relativePath(value = ''): string {
  if (
    typeof value !== 'string' ||
    value.startsWith('/') ||
    Buffer.byteLength(value) > MAX_PATH_BYTES
  ) {
    throw new HttpError(400, 'File path is invalid');
  }
  const parts = value ? value.split('/') : [];
  if (
    parts.length > MAX_DEPTH ||
    parts.some(
      (part) => !part || part.startsWith('.') || part.length > 255 || hasControlCharacter(part),
    )
  ) {
    throw new HttpError(400, 'File path is invalid');
  }
  return parts.join('/');
}

export function parentPath(relative: string): string {
  const index = relative.lastIndexOf('/');
  return index < 0 ? '' : relative.slice(0, index);
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

export function resolveInside(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new HttpError(400, 'File path is invalid');
  }
  return target;
}

// A symbolic link below the root could point anywhere on the server, so none is
// followed. A missing segment ends the check when the caller is about to create it.
export async function assertNoSymlinks(root: string, relative: string, allowMissing = false) {
  let current = root;
  for (const segment of relative ? relative.split('/') : []) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new HttpError(400, 'Symbolic links are not allowed');
      }
    } catch (error) {
      if (allowMissing && isMissing(error)) return;
      throw error;
    }
  }
}

export async function createSharedDirectory(directory: string): Promise<void> {
  // RestrictSUIDSGID forbids an explicit SGID mode; inherit it from the vault parent.
  await mkdir(directory, { mode: DIRECTORY_MODE & 0o777 });
  const entry = await lstat(directory);
  if (entry.isSymbolicLink()) throw new HttpError(400, 'Symbolic links are not allowed');
  if (!entry.isDirectory()) throw new HttpError(409, 'A file with this name already exists');
  if ((entry.mode & 0o2777) !== DIRECTORY_MODE) await chmod(directory, DIRECTORY_MODE);
}

// Check existing segments without mkdir/chmod; the service may not recreate their parents.
export async function ensureDirectory(root: string, relative: string): Promise<string> {
  let current = root;
  for (const segment of relative ? relative.split('/') : []) {
    current = path.join(current, segment);
    let entry = await lstat(current).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (!entry) {
      try {
        await createSharedDirectory(current);
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
      entry = await lstat(current);
    }
    if (entry.isSymbolicLink()) throw new HttpError(400, 'Symbolic links are not allowed');
    if (!entry.isDirectory()) throw new HttpError(409, 'A file with this name already exists');
  }
  return current;
}

function truncateBytes(value: string, maximum: number): string {
  let result = value;
  while (Buffer.byteLength(result) > maximum) result = [...result].slice(0, -1).join('');
  return result;
}

// A name every system the vault is synced to accepts: no separators, no characters
// Windows or Obsidian refuse, no leading dot (hidden files are not listed), and a
// bounded length that keeps the extension.
export function safeFileName(input: string, fallback = 'file'): string {
  const cleaned = [...(input.split(/[\\/]/).pop() ?? '').normalize('NFC')]
    .map((character) =>
      isControl(character.charCodeAt(0)) || '<>:"|?*'.includes(character) ? '_' : character,
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!cleaned) return fallback;
  const extension = path.extname(cleaned);
  const keepExtension = extension.length > 1 && Buffer.byteLength(extension) <= 16;
  const stem = keepExtension ? cleaned.slice(0, -extension.length) : cleaned;
  const suffix = keepExtension ? extension : '';
  const name = truncateBytes(stem, MAX_NAME_BYTES - Buffer.byteLength(suffix)).trim() + suffix;
  return name || fallback;
}

// The name a collision falls back to: "Rechnung.pdf" becomes "Rechnung (2).pdf".
export function numberedName(name: string, number: number): string {
  if (number < 2) return name;
  const extension = path.extname(name);
  return `${name.slice(0, name.length - extension.length)} (${number})${extension}`;
}
