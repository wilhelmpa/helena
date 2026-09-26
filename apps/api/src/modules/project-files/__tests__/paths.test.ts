import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSharedDirectory, DIRECTORY_MODE, ensureDirectory } from '../paths';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'files-paths-'));
});
afterEach(async () => {
  await chmod(root, 0o700);
  await rm(root, { recursive: true, force: true });
});

describe('shared file directories', () => {
  it('preserves existing parent permissions and content', async () => {
    await mkdir(path.join(root, 'Projects'));
    await chmod(path.join(root, 'Projects'), 0o2750);
    await writeFile(path.join(root, 'Projects', 'original.md'), 'original');
    expect(await ensureDirectory(root, 'Projects')).toBe(path.join(root, 'Projects'));
    expect((await lstat(path.join(root, 'Projects'))).mode & 0o2777).toBe(0o2750);
    expect(await readFile(path.join(root, 'Projects', 'original.md'), 'utf8')).toBe('original');
  });

  it('creates missing nested directories once under concurrent requests with shared permissions', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureDirectory(root, 'Projects/RES/Docs/AI')),
    );
    expect(new Set(results).size).toBe(1);
    for (const relative of [
      'Projects',
      'Projects/RES',
      'Projects/RES/Docs',
      'Projects/RES/Docs/AI',
    ])
      expect((await lstat(path.join(root, relative))).mode & 0o2777).toBe(DIRECTORY_MODE);
  });

  it('inherits SGID from a shared parent and refuses to replace an existing entry', async () => {
    await chmod(root, DIRECTORY_MODE);
    const child = path.join(root, 'AI');
    await createSharedDirectory(child);
    expect((await lstat(child)).mode & 0o2777).toBe(DIRECTORY_MODE);
    await expect(createSharedDirectory(child)).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('refuses symlinks and files while preserving their targets', async () => {
    const target = path.join(root, 'target');
    await mkdir(target);
    await symlink(target, path.join(root, 'link'));
    await expect(ensureDirectory(root, 'link/child')).rejects.toMatchObject({ status: 400 });
    await expect(lstat(path.join(target, 'child'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path.join(root, 'file'), 'keep');
    await expect(ensureDirectory(root, 'file')).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path.join(root, 'file'), 'utf8')).toBe('keep');
  });
});
