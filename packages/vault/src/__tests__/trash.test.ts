import { afterAll, beforeAll, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { purgeVaultTrash, restoreVaultPath, trashVaultPath } from '../files';

let root: string;
const previous = process.env.PROJECT_VAULT_ROOT;
const relative = 'Projects/ABC/Docs/Note.md';

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'vault-trash-'));
  process.env.PROJECT_VAULT_ROOT = root;
  await mkdir(path.join(root, 'Projects/ABC/Docs'), { recursive: true });
});

afterAll(async () => {
  if (previous === undefined) delete process.env.PROJECT_VAULT_ROOT;
  else process.env.PROJECT_VAULT_ROOT = previous;
  await rm(root, { recursive: true, force: true });
});

it('restores repeated names and requires exact dry-run targets before purging', async () => {
  await writeFile(path.join(root, relative), 'first');
  const first = await trashVaultPath(relative);
  await writeFile(path.join(root, relative), 'second');
  const second = await trashVaultPath(relative);
  expect(first).not.toBe(second);
  await restoreVaultPath(relative);
  expect(await readFile(path.join(root, relative), 'utf8')).toBe('first');

  const records = path.join(root, '.trash/.records');
  for (const name of await readdir(records)) {
    const file = path.join(records, name);
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record.target === second) {
      record.trashedAt = '2020-01-01T00:00:00.000Z';
      await writeFile(file, JSON.stringify(record));
    }
  }
  const preview = await purgeVaultTrash({ olderThanDays: 30 });
  expect(preview).toEqual({ targets: [second], applied: false });
  await expect(
    purgeVaultTrash({ olderThanDays: 30, apply: true, confirmTargets: [] }),
  ).rejects.toThrow();
  expect(
    (await purgeVaultTrash({ olderThanDays: 30, apply: true, confirmTargets: preview.targets }))
      .applied,
  ).toBe(true);
  expect(await readFile(path.join(root, relative), 'utf8')).toBe('first');
});

it('keeps later trash items outside an older trashed folder', async () => {
  const folder = 'Projects/ABC/Docs/Folder';
  await mkdir(path.join(root, folder));
  await writeFile(path.join(root, folder, 'old.md'), 'old');
  const oldTarget = await trashVaultPath(folder);
  await mkdir(path.join(root, folder));
  await writeFile(path.join(root, folder, 'new.md'), 'new');
  const newTarget = await trashVaultPath(`${folder}/new.md`);
  expect(newTarget.startsWith(`${oldTarget}/`)).toBe(false);
  await rm(path.join(root, folder), { recursive: true });
  await restoreVaultPath(folder);
  expect(await readFile(path.join(root, folder, 'old.md'), 'utf8')).toBe('old');
  expect(await readFile(path.join(root, newTarget), 'utf8')).toBe('new');
});
