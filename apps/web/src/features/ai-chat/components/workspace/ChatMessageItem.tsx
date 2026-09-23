'use client';

import { useState } from 'react';
import type { ChatStatus } from 'ai';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { cn } from '@/lib/utils';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import type { Artifact } from '../../utils/artifacts';
import { messageText, type PlanUIMessage } from '../../utils/chatMessages';
import ChatMessageBubbleUser from './ChatMessageBubbleUser';
import ChatMessageBubbleAssistant from './ChatMessageBubbleAssistant';
import ChatBranchNav from './ChatBranchNav';
import ChatMessageActions from './ChatMessageActions';
import ChatMessageMeta from './ChatMessageMeta';
import ChatClarificationCard from './ChatClarificationCard';

export interface ChatMessageItemProps {
  message: PlanUIMessage;
  isLast: boolean;
  status: ChatStatus;
  agent: AiAgent;
  agentOnline: boolean;
  projectKey: string | null;
  threadId: string | null;
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

// One turn of the transcript, claude.ai-style: the member's words in a quiet bubble on
// the reading side's end, the agent's answer as plain prose across the column. Its
// actions (copy, edit, answer again, versions ‹ 2/3 ›) and, for an answer, the model and
// time it took sit underneath and show on hover.
export default function ChatMessageItem({
  message,
  isLast,
  status,
  agent,
  agentOnline,
  projectKey,
  threadId,
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
      className="motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in"
    >
      <MessageContent className="gap-1.5">
        <Bubble
          variant={isUser ? 'muted' : 'ghost'}
          className={cn(!isUser && 'w-full', isUser && editing && 'w-full max-w-full')}
        >
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
                agent={agent}
                agentOnline={agentOnline}
                projectKey={projectKey}
                onShowArtifact={onShowArtifact}
              />
            </BubbleContent>
          )}
        </Bubble>
        {!editing && !streaming && (
          <MessageFooter className="min-h-7 gap-1">
            <ChatBranchNav message={message} onSwitchVersion={onSwitchVersion} />
            <ChatMessageActions
              message={message}
              isUser={isUser}
              canRegenerate={!isUser && isLast && status !== 'submitted' && status !== 'streaming'}
              projectKey={projectKey}
              threadId={threadId}
              agentId={agent.id}
              onRegenerate={onRegenerate}
              onEditRequest={() => setEditing(true)}
            />
            {!isUser && <ChatMessageMeta message={message} />}
          </MessageFooter>
        )}
        {showClarification && <ChatClarificationCard onReply={onReply} />}
      </MessageContent>
    </Message>
  );
}
