// The messages of a chat form a tree: every message names the one it follows, and an
// edited question or a regenerated answer is another child of the same parent. The
// chat shows one branch, from a root down to the thread's active message. These are
// the rules over the tree, on the skeleton of a thread's messages.

export interface TreeNode {
  id: number;
  parentId: number | null;
}

export type MessageTree = Map<number, TreeNode>;

export function buildTree(nodes: TreeNode[]): MessageTree {
  return new Map(nodes.map((node) => [node.id, node]));
}

// The shown branch, oldest first: the message and every message above it.
export function pathTo(tree: MessageTree, id: number | null): number[] {
  const path: number[] = [];
  let current = id == null ? undefined : tree.get(id);
  while (current) {
    path.push(current.id);
    current = current.parentId == null ? undefined : tree.get(current.parentId);
  }
  return path.reverse();
}

// The versions of a message: the children of its parent, the first one first.
export function siblingsOf(tree: MessageTree, id: number): number[] {
  const node = tree.get(id);
  if (!node) return [];
  return [...tree.values()]
    .filter((candidate) => candidate.parentId === node.parentId)
    .map((candidate) => candidate.id)
    .sort((a, b) => a - b);
}

// Where a branch ends when one of its messages is picked: down through the newest child
// at every step, so switching to an older version shows the conversation that
// continued from it.
export function latestLeaf(tree: MessageTree, id: number): number {
  const children = new Map<number, number>();
  for (const node of tree.values()) {
    if (node.parentId == null) continue;
    children.set(node.parentId, Math.max(children.get(node.parentId) ?? 0, node.id));
  }
  let current = id;
  for (let next = children.get(current); next != null; next = children.get(current)) {
    current = next;
  }
  return current;
}

// The newest message of the thread, which is shown when no active message is stored.
export function newestMessage(tree: MessageTree): number | null {
  let newest: number | null = null;
  for (const id of tree.keys()) if (newest == null || id > newest) newest = id;
  return newest;
}
