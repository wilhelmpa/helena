import type { VaultTreeItem } from '@/lib/api/endpoints/knowledge';
import { parentPath } from './vaultPaths';

export interface VaultTreeNode {
  item: VaultTreeItem;
  children: VaultTreeNode[];
}

const byTitle = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortNodes(nodes: VaultTreeNode[]): VaultTreeNode[] {
  nodes.sort(
    (a, b) =>
      Number(b.item.kind === 'folder') - Number(a.item.kind === 'folder') ||
      byTitle.compare(a.item.title, b.item.title),
  );
  for (const node of nodes) sortNodes(node.children);
  return nodes;
}

// The flat list of the tree endpoint as nested nodes: in every folder its subfolders
// first, then its notes, each by title. An item whose folder is missing from the list
// is shown at the top level.
export function buildVaultTree(items: VaultTreeItem[], root: string): VaultTreeNode[] {
  const nodes = items.map((item) => ({ item, children: [] as VaultTreeNode[] }));
  const folders = new Map(
    nodes.filter((node) => node.item.kind === 'folder').map((node) => [node.item.path, node]),
  );
  const top: VaultTreeNode[] = [];
  for (const node of nodes) {
    const parent = parentPath(node.item.path);
    const folder = parent === root ? undefined : folders.get(parent);
    (folder ? folder.children : top).push(node);
  }
  return sortNodes(top);
}
