'use client';

import { useState } from 'react';
import type { ChatStatus } from 'ai';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { cn } from '@/lib/utils';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import type { Artifact } from '../../utils/artifacts';
import type { PlanUIMessage } from '../../utils/chatMessages';
import ChatMessageBubbleUser from './ChatMessageBubbleUser';
import ChatMessageBubbleAssistant from './ChatMessageBubbleAssistant';
import ChatBranchNav from './ChatBranchNav';
import ChatMessageActions from './ChatMessageActions';
import ChatMessageMeta, { ChatMessageTime } from './ChatMessageMeta';

export interface ChatMessageItemProps {
  message: PlanUIMessage;
  isLast: boolean;
  status: ChatStatus;
  agent: AiAgent;
  projectKey: string | null;
  threadId: string | null;
  onEdit: (text: string) => void;
  onShowArtifact: (artifact: Artifact) => void;
  onSwitchVersion: (messageId: string) => void;
}

// One turn of the transcript, claude.ai-style: the member's words in a quiet bubble on
// the reading side's end, the agent's answer as plain prose across the column. Its
// actions (copy, edit, versions ‹ 2/3 ›) and, for an answer, the model and time it took
// sit underneath and show on hover. Answering again is the composer's (ChatComposer).
export default function ChatMessageItem({
  message,
  isLast,
  status,
  agent,
  projectKey,
  threadId,
  onEdit,
  onShowArtifact,
  onSwitchVersion,
}: ChatMessageItemProps) {
  const isUser = message.role === 'user';
  const streaming = isLast && !isUser && (status === 'streaming' || status === 'submitted');
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
                projectKey={projectKey}
                onShowArtifact={onShowArtifact}
              />
            </BubbleContent>
          )}
        </Bubble>
        {!editing && !streaming && (
          <MessageFooter className="h-7 gap-1">
            {isUser ? null : <ChatMessageTime message={message} />}
            <ChatBranchNav message={message} onSwitchVersion={onSwitchVersion} />
            <ChatMessageActions
              message={message}
              isUser={isUser}
              projectKey={projectKey}
              threadId={threadId}
              agentId={agent.id}
              onEditRequest={() => setEditing(true)}
            />
            {!isUser && <ChatMessageMeta message={message} />}
            {isUser ? <ChatMessageTime message={message} /> : null}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}
