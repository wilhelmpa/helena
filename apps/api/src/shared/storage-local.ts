import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

// Files on the local disk below STORAGE_ROOT. The bytes of an object are the file
// objects/<key>. Its content type is the file content-types/<key>, because an avatar
// has no database row that records it. A write goes to tmp/ first and is renamed into
// place, so a reader never sees a partly written file.

type Area = 'objects' | 'content-types';

function storageRoot(): string {
  const root = process.env.STORAGE_ROOT?.trim() ?? '';
  if (!path.isAbsolute(root)) throw new Error('STORAGE_ROOT must be an absolute path');
  return path.resolve(root);
}

function storagePath(root: string, area: Area, key: string): string {
  const invalid = key
    .split('/')
    .some((part) => !part || part === '.' || part === '..' || /[\\\0]/.test(part));
  const base = path.join(root, area);
  const target = path.resolve(base, key);
  if (invalid || !target.startsWith(base + path.sep)) throw new Error('Invalid object key');
  return target;
}

async function writeAtomically(root: string, target: string, data: Buffer | string) {
  const temporary = path.join(root, 'tmp', randomUUID());
  await mkdir(path.dirname(temporary), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const root = storageRoot();
  const objectFile = storagePath(root, 'objects', key);
  await writeAtomically(root, storagePath(root, 'content-types', key), contentType);
  await writeAtomically(root, objectFile, body);
}

// The error message never names the file: the public raw routes answer with it.
export async function getObject(
  key: string,
): Promise<{ body: ReadableStream; contentType: string; contentLength?: number }> {
  const root = storageRoot();
  const objectFile = storagePath(root, 'objects', key);
  const info = await stat(objectFile).catch((error: NodeJS.ErrnoException) => {
    throw new Error(
      error.code === 'ENOENT' ? 'Object not found' : `Object could not be read (${error.code})`,
    );
  });
  if (!info.isFile()) throw new Error('Object not found');
  const contentType = await readFile(storagePath(root, 'content-types', key), 'utf8').catch(
    () => '',
  );
  return {
    body: Bun.file(objectFile).stream(),
    contentType: contentType || 'application/octet-stream',
    contentLength: info.size,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const root = storageRoot();
  await rm(storagePath(root, 'objects', key), { force: true });
  await rm(storagePath(root, 'content-types', key), { force: true });
}
