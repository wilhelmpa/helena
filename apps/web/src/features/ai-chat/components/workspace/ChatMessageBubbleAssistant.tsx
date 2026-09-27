'use client';

import { ModelRouteLine } from '@/features/decisions/components/ModelRouteLine';
import VoiceReplyLine from '@/features/voice/components/VoiceReplyLine';
import { LocalFallbackLine } from '@/features/local-ai/components/LocalFallbackLine';
import { useMemo } from 'react';
import { AgentMessageParts } from '@/components/agent-message/AgentMessageParts';
import type { RenderTool } from '@/components/agent-message/AgentToolGroup';
import { chatSources } from '../../utils/chatSources';
import type { PlanUIMessage } from '../../utils/chatMessages';
import type { Artifact } from '../../utils/artifacts';
import { ARTIFACT_RENDERERS, ArtifactOpenContext } from './ChatArtifactCard';
import ChatApprovalCard from './ChatApprovalCard';
import ChatSources from './ChatSources';
import { useModelFailureText } from '@/features/model-availability/hooks/useModelFailureText';

export interface ChatMessageBubbleAssistantProps {
  message: PlanUIMessage;
  streaming: boolean;
  projectKey: string | null;
  onShowArtifact: (artifact: Artifact) => void;
}

// `request_approval` is not shown as a tool call: it is the approval card the owner
// decides on.
const renderApproval: RenderTool = (tool) =>
  tool.toolName === 'request_approval' ? <ChatApprovalCard tool={tool} /> : undefined;

// An agent's answer: its reasoning, tool calls and text (AgentMessageParts), artifact
// fences as cards that open the artifact panel, an error the answer ended with, and,
// once it is done, what it drew on. While it has nothing yet it shows nothing;
// the Orb carries the active state.
export default function ChatMessageBubbleAssistant({
  message,
  streaming,
  projectKey,
  onShowArtifact,
}: ChatMessageBubbleAssistantProps) {
  const sources = useMemo(
    () => (streaming ? [] : chatSources(message, projectKey ? [projectKey] : [])),
    [message, projectKey, streaming],
  );
  const error = message.metadata?.error;
  // A failure the runtime explained (a model the provider refused) in the reader's language.
  const explained = useModelFailureText()(
    message.metadata?.errorCode
      ? {
          code: message.metadata.errorCode,
          model: message.metadata.errorModel ?? message.metadata.model,
        }
      : null,
  );

  return (
    <ArtifactOpenContext.Provider value={onShowArtifact}>
      <div className="space-y-3">
        <AgentMessageParts
          message={message}
          streaming={streaming}
          renderTool={renderApproval}
          renderers={ARTIFACT_RENDERERS}
        />
        {error && (
          <p dir="auto" className="text-sm text-destructive" title={explained ? error : undefined}>
            {explained ?? error}
          </p>
        )}
        {sources.length > 0 && <ChatSources sources={sources} projectKey={projectKey} />}
        {!streaming && message.metadata?.modelRoute?.routed && (
          <ModelRouteLine route={message.metadata.modelRoute} />
        )}
        {!streaming && message.metadata?.via === 'voice' && (
          <VoiceReplyLine model={message.metadata.model} />
        )}
        {!streaming && message.metadata?.localFallback && (
          <LocalFallbackLine
            fallback={message.metadata.localFallback}
            model={message.metadata.model}
          />
        )}
      </div>
    </ArtifactOpenContext.Provider>
  );
}
