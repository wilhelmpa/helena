import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeManagedMarkdown } from './managed-markdown.js';

test('writes managed Markdown inside the workspace with private permissions', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'managed-markdown-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true })));

  await writeManagedMarkdown(root, {
    kind: 'memory',
    path: 'memory/team.md',
    content: '# Team',
  });

  const target = path.join(root, 'memory/team.md');
  assert.equal(await readFile(target, 'utf8'), '# Team');
  assert.equal((await stat(target)).mode & 0o777, 0o600);
});

test('rejects an intermediate symlink that escapes the workspace', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'managed-markdown-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'managed-markdown-outside-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all([rm(root, { recursive: true }), rm(outside, { recursive: true })]);
  });
  await symlink(outside, path.join(root, 'memory'));

  await assert.rejects(
    writeManagedMarkdown(root, {
      kind: 'memory',
      path: 'memory/team.md',
      content: '# Escaped',
    }),
    /parent escapes workspace/,
  );
  await assert.rejects(readFile(path.join(outside, 'team.md'), 'utf8'));
});

test('does not follow an existing target symlink', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'managed-markdown-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'managed-markdown-outside-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all([rm(root, { recursive: true }), rm(outside, { recursive: true })]);
  });
  await mkdir(path.join(root, 'memory'));
  const outsideFile = path.join(outside, 'team.md');
  await writeFile(outsideFile, 'unchanged');
  await symlink(outsideFile, path.join(root, 'memory/team.md'));

  await assert.rejects(
    writeManagedMarkdown(root, {
      kind: 'memory',
      path: 'memory/team.md',
      content: '# Escaped',
    }),
    { code: 'ELOOP' },
  );
  assert.equal(await readFile(outsideFile, 'utf8'), 'unchanged');
});
