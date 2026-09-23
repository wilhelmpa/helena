import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deleteObject, getObject, putObject } from '../../storage-local';

const originalRoot = process.env.STORAGE_ROOT;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'itsaplan-storage-unit-'));
  process.env.STORAGE_ROOT = root;
});

afterEach(() => {
  if (originalRoot === undefined) delete process.env.STORAGE_ROOT;
  else process.env.STORAGE_ROOT = originalRoot;
});

async function readObject(key: string) {
  const object = await getObject(key);
  return { ...object, text: await new Response(object.body).text() };
}

describe('local storage', () => {
  it('stores the bytes as a plain file and returns them with their content type', async () => {
    await putObject('avatars/abc', Buffer.from('png bytes'), 'image/png');

    expect(await readObject('avatars/abc')).toMatchObject({
      text: 'png bytes',
      contentType: 'image/png',
      contentLength: 9,
    });
    expect(await readFile(path.join(root, 'objects/avatars/abc'), 'utf8')).toBe('png bytes');
  });

  it('replaces an object through a temporary file that is gone afterwards', async () => {
    await putObject('skills/team/1/refs/a.md', Buffer.from('one'), 'text/markdown');
    await putObject('skills/team/1/refs/a.md', Buffer.from('two'), 'text/plain');

    expect(await readObject('skills/team/1/refs/a.md')).toMatchObject({
      text: 'two',
      contentType: 'text/plain',
    });
    expect(await readdir(path.join(root, 'tmp'))).toEqual([]);
  });

  it('removes the temporary file when the write fails', async () => {
    await mkdir(path.join(root, 'objects/projects/1/taken'), { recursive: true });

    await expect(putObject('projects/1/taken', Buffer.from('x'), 'text/plain')).rejects.toThrow();
    expect(await readdir(path.join(root, 'tmp'))).toEqual([]);
  });

  it('rejects keys that are absolute, empty, or leave the storage root', async () => {
    const keys = ['/etc/passwd', '../escape', 'a/../../escape', 'a//b', 'a/./b', '', 'a/', 'a\\b'];
    for (const key of keys) {
      await expect(putObject(key, Buffer.from('x'), 'text/plain')).rejects.toThrow(
        'Invalid object key',
      );
      await expect(getObject(key)).rejects.toThrow('Invalid object key');
      await expect(deleteObject(key)).rejects.toThrow('Invalid object key');
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('reports a missing object without naming the file', async () => {
    await expect(getObject('avatars/missing')).rejects.toThrow(/^Object not found$/);
  });

  it('deletes the object and its content type, and ignores a missing one', async () => {
    await putObject('projects/1/chat/f.txt', Buffer.from('x'), 'text/plain');

    await deleteObject('projects/1/chat/f.txt');
    await deleteObject('projects/1/chat/f.txt');

    await expect(getObject('projects/1/chat/f.txt')).rejects.toThrow('Object not found');
    expect(await readdir(path.join(root, 'objects/projects/1/chat'))).toEqual([]);
    expect(await readdir(path.join(root, 'content-types/projects/1/chat'))).toEqual([]);
  });

  it('refuses a relative STORAGE_ROOT', async () => {
    process.env.STORAGE_ROOT = 'storage';
    await expect(putObject('avatars/abc', Buffer.from('x'), 'image/png')).rejects.toThrow(
      'STORAGE_ROOT must be an absolute path',
    );
  });
});
