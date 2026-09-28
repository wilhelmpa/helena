import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vaultNotePath } from '@/utils/paths';
import { chatUploadScope, chatVaultPath } from './chatVaultPaths';

test('project picker and upload paths retain their project and entire relative path', () => {
  const path = chatVaultPath('vol', 'Files/proof/Cycle.md');
  assert.equal(path, 'Projects/VOL/Files/proof/Cycle.md');
  assert.equal(
    vaultNotePath(path),
    '/project/VOL/files?path=Files%2Fproof&file=Files%2Fproof%2FCycle.md',
  );
  assert.equal(chatVaultPath('VOL', 'Chat Uploads/a b.pdf'), 'Projects/VOL/Chat Uploads/a b.pdf');
  assert.deepEqual(chatUploadScope('VOL'), { kind: 'project', projectKey: 'VOL', root: 'vault' });
});

test('Home chat paths retain Home and the first folder instead of losing it', () => {
  const path = chatVaultPath('team:1', 'Docs/proof.md');
  assert.equal(path, 'Home/Docs/proof.md');
  assert.equal(vaultNotePath(path), '/files?root=home&path=Docs&file=Docs%2Fproof.md');
  assert.deepEqual(chatUploadScope('team:1'), { kind: 'home', root: 'home' });
});
