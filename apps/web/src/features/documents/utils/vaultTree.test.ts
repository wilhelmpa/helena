import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VaultTreeItem } from '@/lib/api/endpoints/knowledge';
import { buildVaultTree, type VaultTreeNode } from './vaultTree';

const ROOT = 'Projects/VOL/Docs';

function item(path: string, kind: 'note' | 'folder', title = path.split('/').pop()!) {
  return { path, name: path.split('/').pop()!, kind, title, updatedAt: null } as VaultTreeItem;
}

const shape = (nodes: VaultTreeNode[]): unknown[] =>
  nodes.map((node) =>
    node.children.length > 0 ? [node.item.title, shape(node.children)] : node.item.title,
  );

describe('buildVaultTree', () => {
  it('nests the path-sorted list, folders first, then notes by title', () => {
    const tree = buildVaultTree(
      [
        item(`${ROOT}/Guides`, 'folder'),
        item(`${ROOT}/Guides/Release.md`, 'note', 'Release'),
        item(`${ROOT}/Guides/Deploy.md`, 'note', 'Deploy'),
        item(`${ROOT}/Guides/Old`, 'folder'),
        item(`${ROOT}/Guides/Old/Setup.md`, 'note', 'Setup'),
        item(`${ROOT}/Note 10.md`, 'note', 'Note 10'),
        item(`${ROOT}/Note 2.md`, 'note', 'Note 2'),
        item(`${ROOT}/Archive`, 'folder'),
      ],
      ROOT,
    );

    assert.deepEqual(shape(tree), [
      'Archive',
      ['Guides', [['Old', ['Setup']], 'Deploy', 'Release']],
      'Note 2',
      'Note 10',
    ]);
  });

  it('shows an item whose folder is missing at the top level', () => {
    const tree = buildVaultTree([item(`${ROOT}/Gone/Orphan.md`, 'note', 'Orphan')], ROOT);
    assert.deepEqual(shape(tree), ['Orphan']);
  });
});
