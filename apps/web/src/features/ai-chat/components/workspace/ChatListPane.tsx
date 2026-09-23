'use client';

import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { ChatLayoutMode } from '../../utils/chatLayout';
import ChatListPaneBody from './ChatListPaneBody';

export interface ChatListPaneProps {
  scopeKey: string;
  projectKey: string | null;
  agents: AiAgent[];
  mode: ChatLayoutMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedThreadId: string | null;
  onSelectThread: (thread: { id: string; agentId: number }) => void;
  onNewChat: (agentId: number) => void;
}

// The chat list: pinned chats, then grouped by when they were last written in (see
// chatGroups.ts). Wide enough, it is a column to the side of the conversation; below
// @3xl/chat (the CHAT_SPLIT_WIDTH the utility and this class share) it becomes a Sheet
// drawer instead, which is what makes it work in the tool panel and on a phone without a
// second layout to maintain.
export default function ChatListPane(props: ChatListPaneProps) {
  const t = useTranslations('chatWorkspace');
  const { mode, open, onOpenChange } = props;

  if (mode === 'compact') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-80 p-0 sm:max-w-sm">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('list.title')}</SheetTitle>
          </SheetHeader>
          <ChatListPaneBody {...props} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div className="hidden w-72 shrink-0 border-e @3xl/chat:flex @3xl/chat:flex-col">
      <ChatListPaneBody {...props} />
    </div>
  );
}
