import type { ChatFolder } from '@/lib/api/endpoints/userPreferences';

// The member's own chat folders (owner, O4) in the sidebar's chat list: which folder a chat is
// in, and creating, renaming, dissolving and filling them. Pure, so the list and the tests
// share it.

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
