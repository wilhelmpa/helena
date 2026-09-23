'use client';

import { useState } from 'react';
import type { ChatStatus } from 'ai';
import { cn } from '@/lib/utils';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import type { Artifact } from '../../utils/artifacts';
import { messageText, type PlanUIMessage } from '../../utils/chatMessages';
import ChatMessageBubbleUser from './ChatMessageBubbleUser';
import ChatMessageBubbleAssistant from './ChatMessageBubbleAssistant';
import ChatBranchNav from './ChatBranchNav';
import ChatMessageActions from './ChatMessageActions';
import ChatClarificationCard from './ChatClarificationCard';

export interface ChatMessageItemProps {
  message: PlanUIMessage;
  isLast: boolean;
  status: ChatStatus;
  projectKey: string | null;
  threadId: string | null;
  agentId: number;
  onRegenerate: () => void;
  onEdit: (text: string) => void;
  onReply: (text: string) => void;
  onShowArtifact: (artifact: Artifact) => void;
  onSwitchVersion: (messageId: string) => void;
}

// A question ending in "?" that closed the conversation gets a quick reply card right
// under it — a person waiting for it should not have to look down at the composer to
// see that it is their turn.
function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith('?') || trimmed.endsWith('؟');
}

export default function ChatMessageItem({
  message,
  isLast,
  status,
  projectKey,
  threadId,
  agentId,
  onRegenerate,
  onEdit,
  onReply,
  onShowArtifact,
  onSwitchVersion,
}: ChatMessageItemProps) {
  const isUser = message.role === 'user';
  const streaming = isLast && !isUser && (status === 'streaming' || status === 'submitted');
  const text = messageText(message);
  const showClarification =
    !isUser && isLast && status === 'ready' && text !== '' && looksLikeQuestion(text);
  const [editing, setEditing] = useState(false);

  return (
    <Message
      align={isUser ? 'end' : 'start'}
      className="motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in"
    >
      <MessageContent>
        <Bubble variant={isUser ? 'muted' : 'ghost'} className={cn('gap-2', !isUser && 'w-full')}>
          {isUser ? (
            <ChatMessageBubbleUser
              message={message}
              editing={editing}
              onStopEditing={() => setEditing(false)}
              onEdit={onEdit}
            />
          ) : (
            <BubbleContent className="w-full">
              <ChatMessageBubbleAssistant
                message={message}
                streaming={streaming}
                projectKey={projectKey}
                onShowArtifact={onShowArtifact}
              />
            </BubbleContent>
          )}
        </Bubble>
        {!editing && (
          <MessageFooter className="gap-1">
            <ChatBranchNav message={message} onSwitchVersion={onSwitchVersion} />
            <ChatMessageActions
              message={message}
              isUser={isUser}
              canRegenerate={!isUser && isLast && status === 'ready'}
              projectKey={projectKey}
              threadId={threadId}
              agentId={agentId}
              onRegenerate={onRegenerate}
              onEditRequest={() => setEditing(true)}
            />
          </MessageFooter>
        )}
        {showClarification && <ChatClarificationCard onReply={onReply} />}
      </MessageContent>
    </Message>
  );
}
