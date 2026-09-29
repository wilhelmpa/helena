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
  // Where the drawer opens in the compact layout: next to the button that opens it.
  side?: 'start' | 'end';
  selectedThreadId: string | null;
  onSelectThread: (thread: { id: string; agentId: number }) => void;
  // A chat was deleted: the open one closes.
  onThreadRemoved: (threadId: string) => void;
  onNewChat: () => void;
}

// The chat list: pinned chats, then grouped by when they were last written in, by project
// or by agent (see chatGroups.ts), in the sidebar's own look. Wide enough, it is a column
// to the side of the conversation; below @3xl/chat it becomes a floating drawer over the
// chat instead (ChatListDrawer), which is what makes it work in the tool panel and on a
// phone without a second layout to maintain.
export default function ChatListPane(props: ChatListPaneProps) {
  const { mode, open, onOpenChange, side } = props;

  if (mode === 'compact') {
    return (
      <ChatListDrawer open={open} onOpenChange={onOpenChange} side={side}>
        <ChatListPaneBody {...props} />
      </ChatListDrawer>
    );
  }

  return (
    <div className="ds-chat-list-column">
      <ChatListPaneBody {...props} />
    </div>
  );
}
