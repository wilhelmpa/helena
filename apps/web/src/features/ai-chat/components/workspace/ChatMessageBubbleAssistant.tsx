'use client';

import { useMemo } from 'react';
import Markdown from '@/components/common/Markdown';
import { splitArtifacts } from '../../utils/artifacts';
import { chatSources } from '../../utils/chatSources';
import { messageBlocks, type PlanUIMessage } from '../../utils/chatMessages';
import type { Artifact } from '../../utils/artifacts';
import ChatReasoningDisclosure from './ChatReasoningDisclosure';
import ChatToolCallDisclosure from './ChatToolCallDisclosure';
import ChatArtifactCard from './ChatArtifactCard';
import ChatSourcesFooter from './ChatSourcesFooter';

export interface ChatMessageBubbleAssistantProps {
  message: PlanUIMessage;
  streaming: boolean;
  projectKey: string | null;
  onShowArtifact: (artifact: Artifact) => void;
}

// An agent's answer: its reasoning and tool calls where the model made them, its
// prose as Markdown, any artifact fences as cards instead of raw code, and, once it is
// done, what it drew on. While it has nothing yet it shows nothing: the composer says
// the agent is thinking (ChatComposerStatus).
export default function ChatMessageBubbleAssistant({
  message,
  streaming,
  projectKey,
  onShowArtifact,
}: ChatMessageBubbleAssistantProps) {
  const blocks = useMemo(() => messageBlocks(message), [message]);
  const sources = useMemo(
    () => (streaming ? [] : chatSources(message, projectKey ? [projectKey] : [])),
    [message, projectKey, streaming],
  );
  const error = message.metadata?.error;

  if (blocks.length === 0 && !error) return null;

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((block, index) => {
        if (block.kind === 'reasoning') {
          return (
            <ChatReasoningDisclosure
              key={index}
              text={block.text}
              streaming={streaming && index === blocks.length - 1}
            />
          );
        }
        if (block.kind === 'tools') {
          return <ChatToolCallDisclosure key={index} tools={block.tools} />;
        }
        const { text, artifacts } = splitArtifacts(block.text);
        return (
          <div key={index} className="space-y-3">
            {text && <Markdown>{text}</Markdown>}
            {artifacts.map((artifact, artifactIndex) => (
              <ChatArtifactCard key={artifactIndex} artifact={artifact} onOpen={onShowArtifact} />
            ))}
          </div>
        );
      })}
      {error && (
        <p dir="auto" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {sources.length > 0 && <ChatSourcesFooter sources={sources} projectKey={projectKey} />}
    </div>
  );
}
