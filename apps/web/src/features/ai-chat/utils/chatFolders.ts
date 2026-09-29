import type { ChatFolder } from '@/lib/api/endpoints/userPreferences';
import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import type { ChatGroup } from './chatGroups';

// The member's own chat folders (owner, O4), next to the automatic groups: the folders come
// first, each with the chats filed in it (in the list's order); those chats leave the other
// groups. Pure, so the list and the tests share it.

export function withFolders(
  groups: ChatGroup[],
  chats: ChatSummary[],
  folders: ChatFolder[],
): ChatGroup[] {
  if (folders.length === 0) return groups;
  const folderOf = new Map<string, string>();
  for (const folder of folders) for (const id of folder.threads) folderOf.set(id, folder.id);
  const folderGroups: ChatGroup[] = folders.map((folder) => ({
    key: `f:${folder.id}`,
    label: folder.name,
    folderId: folder.id,
    chats: chats.filter((chat) => folderOf.get(chat.id) === folder.id),
  }));
  const rest = groups
    .map((group) => ({ ...group, chats: group.chats.filter((chat) => !folderOf.has(chat.id)) }))
    .filter((group) => group.chats.length > 0);
  return [...folderGroups, ...rest];
}

export function folderOfThread(folders: ChatFolder[], threadId: string): ChatFolder | null {
  return folders.find((folder) => folder.threads.includes(threadId)) ?? null;
}

// A new folder, with a chat already in it when one is given.
export function addFolder(
  folders: ChatFolder[],
  name: string,
  id: string,
  threadId?: string,
): ChatFolder[] {
  const cleared = threadId ? moveToFolder(folders, threadId, null) : folders;
  return [...cleared, { id, name: name.trim(), threads: threadId ? [threadId] : [] }];
}

export function renameFolder(folders: ChatFolder[], id: string, name: string): ChatFolder[] {
  return folders.map((folder) => (folder.id === id ? { ...folder, name: name.trim() } : folder));
}

// Dissolving a folder keeps its chats: they go back to the automatic groups.
export function removeFolder(folders: ChatFolder[], id: string): ChatFolder[] {
  return folders.filter((folder) => folder.id !== id);
}

// A chat into a folder (out of any other), or out of every folder (`null`).
export function moveToFolder(
  folders: ChatFolder[],
  threadId: string,
  folderId: string | null,
): ChatFolder[] {
  return folders.map((folder) => {
    const without = folder.threads.filter((id) => id !== threadId);
    return folder.id === folderId
      ? { ...folder, threads: [...without, threadId] }
      : { ...folder, threads: without };
  });
}

// A deleted chat leaves its folder, so no folder keeps an id that points nowhere.
export function forgetThread(folders: ChatFolder[], threadId: string): ChatFolder[] {
  return moveToFolder(folders, threadId, null);
}
