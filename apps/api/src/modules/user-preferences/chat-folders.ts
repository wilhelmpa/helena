// A member's own chat folders (owner, O4), kept in the per-user preference JSON.
export interface ChatFolder {
  id: string;
  name: string;
  threads: string[];
}

// Stored folders read back safely: named, unique ids, each chat in one folder only.
export function normalizeChatFolders(value: unknown): ChatFolder[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seenFolders = new Set<string>();
  const seenThreads = new Set<string>();
  const folders: ChatFolder[] = [];
  for (const raw of value.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id.slice(0, 64) : '';
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 80) : '';
    if (!id || !name || seenFolders.has(id)) continue;
    seenFolders.add(id);
    const threads = (Array.isArray(entry.threads) ? entry.threads : [])
      .filter((thread): thread is string => typeof thread === 'string' && thread.length > 0)
      .filter((thread) => !seenThreads.has(thread) && seenThreads.add(thread))
      .slice(0, 500);
    folders.push({ id, name, threads });
  }
  return folders;
}
