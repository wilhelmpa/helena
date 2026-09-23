'use client';

import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerProvider,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import InitialScrollToEnd from '@/components/common/agent-chat/InitialScrollToEnd';
import type { PlanChat } from '../../hooks/usePlanChat';
import type { Artifact } from '../../utils/artifacts';
import type { PlanUIMessage } from '../../utils/chatMessages';
import ChatMessageItem from './ChatMessageItem';

// An answer that has nothing to show yet (no text, reasoning or tool call, no error).
const isEmptyAnswer = (message: PlanUIMessage) =>
  message.role === 'assistant' && message.parts.length === 0 && !message.metadata?.error;

export interface ChatMessageListProps {
  plan: PlanChat;
  agent: AiAgent;
  projectKey: string | null;
  threadId: string | null;
  onShowArtifact: (artifact: Artifact) => void;
}

// The transcript, in the shared MessageScroller: it keeps the view pinned to the
// newest message while the reader stays at the bottom, and stops the moment they
// scroll up to read back, with a button to jump back down. Centered at a comfortable
// reading width rather than filling the pane edge to edge, the way claude.ai reads.
// Only messages: an answer with nothing to show yet is left out, and what the answer is
// doing is said at the composer (ChatComposerStatus).
export default function ChatMessageList({
  plan,
  agent,
  projectKey,
  threadId,
  onShowArtifact,
}: ChatMessageListProps) {
  const t = useTranslations('chatWorkspace');
  const { messages, status } = plan;

  if (plan.restoring) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-hidden px-4 py-6">
        <Skeleton className="ms-auto h-9 w-1/2 rounded-2xl" />
        <Skeleton className="h-20 w-3/4" />
        <Skeleton className="ms-auto h-9 w-2/5 rounded-2xl" />
      </div>
    );
  }

  return (
    <MessageScrollerProvider>
      <MessageScroller className="flex-1">
        <InitialScrollToEnd hasMessages={messages.length > 0} />
        <MessageScrollerViewport aria-label={t('messages.transcript')}>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 px-4 pt-6 pb-6">
            {plan.hasOlder && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={plan.loadingOlder}
                  onClick={() => void plan.loadOlder()}
                >
                  {plan.loadingOlder ? t('messages.loading') : t('messages.loadOlder')}
                </Button>
              </div>
            )}
            {messages.map((message, index) =>
              isEmptyAnswer(message) ? null : (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === 'user'}
                >
                  <ChatMessageItem
                    message={message}
                    isLast={index === messages.length - 1}
                    status={status}
                    agent={agent}
                    projectKey={projectKey}
                    threadId={threadId}
                    onEdit={(text) => void plan.edit(index, text)}
                    onShowArtifact={onShowArtifact}
                    onSwitchVersion={(messageId) => void plan.switchVersion(messageId)}
                  />
                </MessageScrollerItem>
              ),
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
