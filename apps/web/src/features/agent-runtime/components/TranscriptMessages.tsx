'use client';

import { useFormatter } from 'next-intl';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent } from '@/components/ui/message';
import Markdown from '@/components/common/Markdown';
import type { PlanUIMessage } from '@/features/ai-chat/utils/chatMessages';
import { messageText } from '@/features/ai-chat/utils/chatMessages';
import ChatMessageBubbleAssistant from '@/features/ai-chat/components/workspace/ChatMessageBubbleAssistant';

// A run's timeline or a session's transcript, drawn with the chat's own message parts:
// the person's words in a quiet bubble, the agent's reasoning, tool calls and text as in an
// answer. `streaming` keeps the last answer's reasoning open while the run is running.
export default function TranscriptMessages({
  messages,
  streaming = false,
  projectKey = null,
}: {
  messages: PlanUIMessage[];
  streaming?: boolean;
  projectKey?: string | null;
}) {
  const format = useFormatter();
  return (
    <div className="flex flex-col gap-4">
      {messages.map((message, index) => {
        const time = message.metadata?.createdAt
          ? format.dateTime(new Date(message.metadata.createdAt), {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          : null;
        if (message.role !== 'assistant') {
          return (
            <Message key={message.id} align="end">
              <MessageContent className="gap-1">
                <Bubble variant="muted">
                  <BubbleContent>
                    <div className="text-sm">
                      <Markdown>{messageText(message)}</Markdown>
                    </div>
                  </BubbleContent>
                </Bubble>
                {time && <span className="self-end text-xs text-muted-foreground">{time}</span>}
              </MessageContent>
            </Message>
          );
        }
        return (
          <Message key={message.id} align="start">
            <MessageContent className="gap-1">
              <Bubble variant="ghost" className="w-full">
                <BubbleContent className="w-full">
                  <ChatMessageBubbleAssistant
                    message={message}
                    streaming={streaming && index === messages.length - 1}
                    projectKey={projectKey}
                    onShowArtifact={() => {}}
                  />
                </BubbleContent>
              </Bubble>
              {time && (
                <span className="text-xs text-muted-foreground">
                  {time}
                  {message.metadata?.model ? ` · ${message.metadata.model}` : ''}
                </span>
              )}
            </MessageContent>
          </Message>
        );
      })}
    </div>
  );
}
