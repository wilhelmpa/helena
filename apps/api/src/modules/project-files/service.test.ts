import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import {
  createProjectText,
  deleteProjectFile,
  listProjectFiles,
  projectFileDeleteBody,
  projectFilesSlug,
  projectTextUpsertBody,
  readProjectText,
  upsertProjectText,
} from './service';

const originalRoot = process.env.PROJECT_VAULT_ROOT;

afterEach(() => {
  if (originalRoot === undefined) delete process.env.PROJECT_VAULT_ROOT;
  else process.env.PROJECT_VAULT_ROOT = originalRoot;
});

test('maps project keys to their canonical vault folder', () => {
  assert.equal(projectFilesSlug('KARR'), 'KARR');
  assert.equal(projectFilesSlug('verv'), 'VERV');
});

test('uses create-only semantics for the first generated Markdown export', () => {
  assert.deepEqual(projectTextUpsertBody('KARR', 'Docs/Plan/doc-42.md', 'body', null), {
    project: 'KARR',
    path: 'Docs/Plan/doc-42.md',
    content: 'body',
    expectedEtag: null,
  });
});

test('passes the known strong ETag for updates and privacy cleanup', () => {
  const etag = '"abc123"';
  assert.equal(
    projectTextUpsertBody('KARR', 'Docs/Plan/doc-42.md', 'updated', etag).expectedEtag,
    etag,
  );
  assert.equal(projectFileDeleteBody('KARR', 'Docs/Plan/doc-42.md', etag).expectedEtag, etag);
});

test('stores portable Markdown atomically in the canonical project vault', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plan-vault-'));
  process.env.PROJECT_VAULT_ROOT = root;

  await createProjectText('KARR', 'Docs/notes.md', '# Notes');
  const first = await readProjectText('KARR', 'Docs/notes.md');
  const updated = await upsertProjectText('KARR', 'Docs/notes.md', '# Updated', first.etag);
  const listing = await listProjectFiles('KARR', 'Docs');

  assert.equal(updated.created, false);
  assert.equal(await readFile(path.join(root, 'Projects/KARR/Docs/notes.md'), 'utf8'), '# Updated');
  assert.deepEqual(
    listing.items.map(({ name, kind }) => ({ name, kind })),
    [{ name: 'notes.md', kind: 'file' }],
  );
  assert.equal((await deleteProjectFile('KARR', 'Docs/notes.md', updated.etag)).deleted, true);
  assert.equal((await deleteProjectFile('KARR', 'Docs/notes.md')).deleted, false);
});

test('rejects stale writers and symbolic-link escapes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plan-vault-'));
  process.env.PROJECT_VAULT_ROOT = root;
  await createProjectText('KARR', 'Docs/notes.md', 'one');
  const current = await readProjectText('KARR', 'Docs/notes.md');
  await upsertProjectText('KARR', 'Docs/notes.md', 'two', current.etag);

  await assert.rejects(
    upsertProjectText('KARR', 'Docs/notes.md', 'stale', current.etag),
    /changed since it was read/,
  );
  await mkdir(path.join(root, 'Projects/KARR'), { recursive: true });
  await symlink(os.tmpdir(), path.join(root, 'Projects/KARR/outside'));
  await assert.rejects(createProjectText('KARR', 'outside/leak.md', 'blocked'), /Symbolic links/);
});
