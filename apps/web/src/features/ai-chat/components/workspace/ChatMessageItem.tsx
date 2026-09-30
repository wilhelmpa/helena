'use client';

import { memo } from 'react';
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
import FollowupNotes from '@/components/helena/FollowupNotes';
import type { Followup } from '@/lib/api/endpoints/agentFollowups';
import ChatMessageActions from './ChatMessageActions';
import ChatMessageMeta, { ChatMessageTime } from './ChatMessageMeta';

export interface ChatMessageItemProps {
  message: PlanUIMessage;
  isLast: boolean;
  status: ChatStatus;
  agent: AiAgent;
  projectKey: string | null;
  threadId: string | null;
  // This message is being edited (only the member's own; ↑ in an empty composer opens
  // the last one).
  editing: boolean;
  onEditingChange: (messageId: string | null) => void;
  onEdit: (messageId: string, text: string) => void;
  onShowArtifact: (artifact: Artifact) => void;
  onSwitchVersion: (messageId: string) => void;
  // The instructions given while this answer ran (see ChatFollowupNotes).
  followups?: Followup[];
}

// One turn of the transcript, claude.ai-style: the member's words in a quiet bubble on
// the reading side's end, the agent's answer as plain prose across the column. Its
// actions (copy, read aloud, edit, versions ‹ 2/3 ›) and, for an answer, the model and
// time it took sit underneath and show on hover. Answering again is the composer's.
function ChatMessageItem({
  message,
  isLast,
  status,
  agent,
  projectKey,
  threadId,
  editing,
  onEditingChange,
  onEdit,
  onShowArtifact,
  onSwitchVersion,
  followups,
}: ChatMessageItemProps) {
  const isUser = message.role === 'user';
  const streaming = isLast && !isUser && (status === 'streaming' || status === 'submitted');

  return (
    <Message
      align={isUser ? 'end' : 'start'}
      // A screen reader reads an answer once it is complete, not word by word.
      aria-busy={streaming || undefined}
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
              onStopEditing={() => onEditingChange(null)}
              onEdit={(text) => onEdit(message.id, text)}
            />
          ) : (
            <BubbleContent className="w-full">
              <ChatMessageBubbleAssistant
                message={message}
                streaming={streaming}
                projectKey={projectKey}
                agentRuntime={agent.runtimePolicy.runtime ?? 'hermes'}
                onShowArtifact={onShowArtifact}
              />
            </BubbleContent>
          )}
        </Bubble>
        {!isUser && followups && followups.length > 0 && <FollowupNotes items={followups} />}
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
              onEditRequest={() => onEditingChange(message.id)}
            />
            {!isUser && <ChatMessageMeta message={message} />}
            {isUser ? <ChatMessageTime message={message} /> : null}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

// Every message re-renders only when it changes itself, not each time the answer below it
// grows (the list passes stable callbacks).
export default memo(ChatMessageItem);
