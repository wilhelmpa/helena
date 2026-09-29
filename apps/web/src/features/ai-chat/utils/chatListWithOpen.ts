import type { ChatListView, ChatSummary } from '@/lib/api/endpoints/agentChat';

// The chat that is open belongs in the list beside it. A list holds the chats of its scope
// (a project's own), while a chat keeps the scope it was started in — one opened from an
// activity entry or the panel may be Helena's own or another project's — and would leave
// the list saying "no chats yet" beside a conversation that is open. So the open one is
// added where its place is (pinned first, then newest first, as the server sorts), unless
// the list already holds it, a search or the archive/trash view is showing, or the chat
// itself is archived or deleted.
export function withOpenChat(
  chats: ChatSummary[],
  open: ChatSummary | null | undefined,
  view: ChatListView,
  searching: boolean,
): ChatSummary[] {
  if (!open || searching || view !== 'active') return chats;
  if (open.archivedAt || open.deletedAt) return chats;
  if (chats.some((chat) => chat.id === open.id)) return chats;
  const index = chats.findIndex(
    (chat) =>
      (open.pinned && !chat.pinned) ||
      (open.pinned === chat.pinned && chat.updatedAt < open.updatedAt),
  );
  return index < 0 ? [...chats, open] : [...chats.slice(0, index), open, ...chats.slice(index)];
}
