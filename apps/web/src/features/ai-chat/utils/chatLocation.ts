// Where the chat workspace is: the agent it is with and the open thread, null for a new
// chat. The caller keeps it — the URL for the full page, local state in the tool panel.
export interface ChatLocation {
  agentId: number | null;
  threadId: string | null;
}

// Where to go once a thread was deleted: away from it when it is the one open — a new
// chat with the same agent, so nothing of the deleted conversation stays on screen and
// nothing more can be written into it — and nowhere (null) when another one was.
export function locationAfterDeletion(
  location: ChatLocation,
  deletedThreadId: string,
): ChatLocation | null {
  if (location.threadId !== deletedThreadId) return null;
  return { agentId: location.agentId, threadId: null };
}
