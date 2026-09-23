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
import ChatMessageItem from './ChatMessageItem';
import ChatInterruptedBar from './ChatInterruptedBar';

export interface ChatMessageListProps {
  plan: PlanChat;
  agent: AiAgent;
  agentOnline: boolean;
  projectKey: string | null;
  threadId: string | null;
  onShowArtifact: (artifact: Artifact) => void;
}

// The transcript, in the shared MessageScroller: it keeps the view pinned to the
// newest message while the reader stays at the bottom, and stops the moment they
// scroll up to read back, with a button to jump back down. Centered at a comfortable
// reading width rather than filling the pane edge to edge, the way claude.ai reads.
// Under the last turn, when an answer did not end the normal way, the bar that offers
// to pick it up again (ChatInterruptedBar).
export default function ChatMessageList({
  plan,
  agent,
  agentOnline,
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
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-6 pb-10">
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
            {messages.map((message, index) => (
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
                  agentOnline={agentOnline}
                  projectKey={projectKey}
                  threadId={threadId}
                  onRegenerate={() => void plan.regenerate(message.id)}
                  onEdit={(text) => void plan.edit(index, text)}
                  onReply={(text) => void plan.send(text, { agentId: agent.id })}
                  onShowArtifact={onShowArtifact}
                  onSwitchVersion={(messageId) => void plan.switchVersion(messageId)}
                />
              </MessageScrollerItem>
            ))}
            <ChatInterruptedBar plan={plan} agent={agent} />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
