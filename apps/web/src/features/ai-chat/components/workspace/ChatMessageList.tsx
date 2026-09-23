'use client';

import type { ChatStatus } from 'ai';
import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Marker, MarkerContent } from '@/components/ui/marker';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerProvider,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import InitialScrollToEnd from '@/components/common/agent-chat/InitialScrollToEnd';
import { formatLongDate } from '@/utils/dates';
import type { Artifact } from '../../utils/artifacts';
import type { PlanUIMessage } from '../../utils/chatMessages';
import ChatMessageItem from './ChatMessageItem';
import ChatEmptyState from './ChatEmptyState';

export interface ChatMessageListProps {
  messages: PlanUIMessage[];
  status: ChatStatus;
  agent: AiAgent;
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRegenerate: (messageId: string) => void;
  onEdit: (index: number, text: string) => void;
  onReply: (text: string) => void;
  onShowArtifact: (artifact: Artifact) => void;
  onSwitchVersion: (messageId: string) => void;
  projectKey: string | null;
  threadId: string | null;
}

// The transcript, in the shared MessageScroller: it keeps the view pinned to the
// newest message while the reader stays at the bottom, and stops the moment they
// scroll up to read back, with a button to jump back down (see message-scroller.tsx,
// already used by the tool panel's chat). Centered at a comfortable reading width
// rather than filling the pane edge to edge.
export default function ChatMessageList({
  messages,
  status,
  agent,
  loading,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onRegenerate,
  onEdit,
  onReply,
  onShowArtifact,
  onSwitchVersion,
  projectKey,
  threadId,
}: ChatMessageListProps) {
  const t = useTranslations('chatWorkspace');

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-hidden p-4">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="ms-auto h-10 w-1/2" />
        <Skeleton className="h-24 w-3/4" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <ChatEmptyState agents={[agent]} onPick={() => undefined} onOpenList={() => undefined} />
    );
  }

  let lastDate = '';

  // The scroller's hooks (InitialScrollToEnd) read the provider's context, not the root's;
  // without it the first rendered message throws and takes the page down.
  return (
    <MessageScrollerProvider>
      <MessageScroller>
        <InitialScrollToEnd hasMessages={messages.length > 0} />
        <MessageScrollerViewport aria-label={t('messages.transcript')}>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 p-4 pb-8">
            {hasOlder && (
              <div className="flex justify-center pb-2">
                <Button variant="outline" size="sm" disabled={loadingOlder} onClick={onLoadOlder}>
                  {loadingOlder ? t('messages.loading') : t('messages.loadOlder')}
                </Button>
              </div>
            )}
            {messages.map((message, index) => {
              const createdAt = message.metadata?.createdAt;
              const day = createdAt ? formatLongDate(createdAt) : '';
              const showDate = day !== '' && day !== lastDate;
              if (showDate) lastDate = day;
              return (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === 'user'}
                  className="flex flex-col gap-6"
                >
                  {showDate && (
                    <Marker variant="separator">
                      <MarkerContent>{day}</MarkerContent>
                    </Marker>
                  )}
                  <ChatMessageItem
                    message={message}
                    isLast={index === messages.length - 1}
                    status={status}
                    projectKey={projectKey}
                    threadId={threadId}
                    agentId={agent.id}
                    onRegenerate={() => onRegenerate(message.id)}
                    onEdit={(text) => onEdit(index, text)}
                    onReply={onReply}
                    onShowArtifact={onShowArtifact}
                    onSwitchVersion={onSwitchVersion}
                  />
                </MessageScrollerItem>
              );
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
