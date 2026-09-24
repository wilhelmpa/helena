'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { CustomRenderer } from 'streamdown';
import { cn } from '@/lib/utils';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { AgentMarkdownProvider, AgentText } from './AgentMarkdown';
import { AgentToolGroup, type RenderTool } from './AgentToolGroup';
import { messageBlocks, messageMarkdown } from './messageBlocks';

export interface AgentMessagePartsProps {
  // An AI SDK UIMessage (any metadata and data parts): its text, reasoning and tool parts
  // are drawn, anything else is left to the caller.
  message: { parts: readonly { type: string; text?: string }[] };
  // The message is still being written: its last stretch streams.
  streaming?: boolean;
  // Tools the caller draws itself (see AgentToolGroup).
  renderTool?: RenderTool;
  // Fences the caller draws itself (see AgentMarkdownProvider).
  renderers?: CustomRenderer[];
  className?: string;
}

// What an agent wrote, in the order it did: its reasoning (open while it thinks), the
// tool calls it made (folded per stretch), and its text as Markdown. The chat draws an
// answer with it, and any view of an agent's work can draw a transcript the same way
// once it has UIMessage parts (hub/hermes-in-helena's run and session views).
export function AgentMessageParts({
  message,
  streaming = false,
  renderTool,
  renderers,
  className,
}: AgentMessagePartsProps) {
  const t = useTranslations('common.agentChat');
  const blocks = useMemo(() => messageBlocks(message), [message]);
  // Tool arguments and results are shown as code blocks, so a message with tools needs
  // the highlighter as much as one with a fence.
  const source = useMemo(() => {
    const markdown = messageMarkdown(message);
    return blocks.some((block) => block.kind === 'tools') ? `${markdown}\n\`\`\`` : markdown;
  }, [message, blocks]);

  if (blocks.length === 0) return null;

  return (
    <AgentMarkdownProvider source={source} renderers={renderers}>
      <div className={cn('space-y-3 text-sm', className)}>
        {blocks.map((block, index) => {
          const live = streaming && index === blocks.length - 1;
          if (block.kind === 'reasoning') {
            return (
              <Reasoning key={index} isStreaming={live}>
                <ReasoningTrigger
                  getThinkingMessage={(thinking, seconds) =>
                    thinking
                      ? t('reasoningLive')
                      : seconds === undefined
                        ? t('reasoningDone')
                        : t('reasoningFor', { seconds })
                  }
                />
                <ReasoningContent>{block.text}</ReasoningContent>
              </Reasoning>
            );
          }
          if (block.kind === 'tools') {
            return <AgentToolGroup key={index} tools={block.tools} renderTool={renderTool} />;
          }
          return (
            <AgentText key={index} streaming={live}>
              {block.text}
            </AgentText>
          );
        })}
      </div>
    </AgentMarkdownProvider>
  );
}
