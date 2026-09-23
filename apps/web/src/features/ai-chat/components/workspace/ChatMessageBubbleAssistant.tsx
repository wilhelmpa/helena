'use client';

import { useMemo } from 'react';
import Markdown from '@/components/common/Markdown';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { useTranslations } from 'next-intl';
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
// done, what it drew on. Empty and still streaming, a status line takes the bubble's
// place so the reader is not staring at nothing while the runner starts up.
export default function ChatMessageBubbleAssistant({
  message,
  streaming,
  projectKey,
  onShowArtifact,
}: ChatMessageBubbleAssistantProps) {
  const t = useTranslations('chatWorkspace');
  const blocks = useMemo(() => messageBlocks(message), [message]);
  const sources = useMemo(
    () => (streaming ? [] : chatSources(message, projectKey ? [projectKey] : [])),
    [message, projectKey, streaming],
  );
  const error = message.metadata?.error;

  if (blocks.length === 0 && !error) {
    return (
      <Marker role="status">
        <MarkerContent className="shimmer">{t('messages.thinking')}</MarkerContent>
      </Marker>
    );
  }

  return (
    <div className="space-y-3">
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
