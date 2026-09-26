import assert from 'node:assert/strict';
import { chmod, lstat, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [modulePath, root] = process.argv.slice(2);
assert.ok(modulePath && root);
const { ensureDirectory, createSharedDirectory } = (await import(
  pathToFileURL(modulePath).href
)) as typeof import('../../paths');
const before = await lstat(path.join(root, 'Projects'));
const folder = await ensureDirectory(root, 'Projects/RES/Docs/AI');
for (let i = 0; i < 7; i++)
  await writeFile(path.join(folder, `note-${i}.md`), 'private fixture', {
    flag: 'wx',
    mode: 0o660,
  });
assert.equal(await readFile(path.join(folder, 'note-0.md'), 'utf8'), 'private fixture');
const after = await lstat(path.join(root, 'Projects'));
assert.equal(after.mode, before.mode);
assert.equal(after.uid, before.uid);
assert.equal(after.gid, before.gid);
const created = await Promise.all(
  Array.from({ length: 6 }, () => ensureDirectory(root, 'Projects/RES/Docs/New/Nested')),
);
assert.equal(new Set(created).size, 1);
assert.equal((await lstat(created[0]!)).mode & 0o2777, 0o2770);
await createSharedDirectory(path.join(folder, 'created-folder'));
assert.equal((await lstat(path.join(folder, 'created-folder'))).mode & 0o2777, 0o2770);
await symlink(folder, path.join(root, 'link'));
await assert.rejects(
  ensureDirectory(root, 'link'),
  (error: unknown) =>
    !!error && typeof error === 'object' && 'status' in error && error.status === 400,
);
await assert.rejects(
  ensureDirectory(root, 'Projects/RES/Docs/AI/note-0.md'),
  (error: unknown) =>
    !!error && typeof error === 'object' && 'status' in error && error.status === 409,
);
// Confirm the real sandbox still refuses an explicit SGID chmod.
await assert.rejects(
  chmod(path.join(folder, 'created-folder'), 0o2770),
  (error: unknown) =>
    !!error && typeof error === 'object' && 'code' in error && error.code === 'EPERM',
);
console.log(
  JSON.stringify({
    existingParentsUnchanged: true,
    filesWritten: 7,
    inheritedDirectoryMode: '2770',
    concurrentCreation: true,
    symlinkDenied: true,
    fileCollisionDenied: true,
    restrictSuidSgidStillEnforced: true,
  }),
);
