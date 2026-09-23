'use client';

import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { ChatLayoutMode } from '../../utils/chatLayout';
import ChatListPaneBody from './ChatListPaneBody';
import ChatListDrawer from './ChatListDrawer';

export interface ChatListPaneProps {
  projectKey: string | null;
  agents: AiAgent[];
  mode: ChatLayoutMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedThreadId: string | null;
  onSelectThread: (thread: { id: string; agentId: number }) => void;
  onNewChat: () => void;
}

// The chat list: pinned chats, then grouped by when they were last written in (see
// chatGroups.ts), in the sidebar's own look. Wide enough, it is a column to the side of
// the conversation; below @3xl/chat (the CHAT_SPLIT_WIDTH the utility and this class
// share) it becomes a drawer over the chat instead (ChatListDrawer), which is what makes
// it work in the tool panel and on a phone without a second layout to maintain.
export default function ChatListPane(props: ChatListPaneProps) {
  const { mode, open, onOpenChange } = props;

  if (mode === 'compact') {
    return (
      <ChatListDrawer open={open} onOpenChange={onOpenChange}>
        <ChatListPaneBody {...props} />
      </ChatListDrawer>
    );
  }

  return (
    <div className="hidden w-64 shrink-0 border-e border-sidebar-border bg-sidebar @3xl/chat:flex @3xl/chat:flex-col">
      <ChatListPaneBody {...props} />
    </div>
  );
}
