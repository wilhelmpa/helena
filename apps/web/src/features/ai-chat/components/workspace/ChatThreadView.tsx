'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { ApiError } from '@/lib/api/core/client';
import { usePlanChat } from '../../hooks/usePlanChat';
import type { ChatAgentState } from '../../utils/agentPresence';
import type { Artifact } from '../../utils/artifacts';
import ChatHeader from './ChatHeader';
import ChatMessageList from './ChatMessageList';
import ChatComposer from './ChatComposer';
import ChatNewChatIntro from './ChatNewChatIntro';
import ChatRestoreError from './ChatRestoreError';

export interface ChatThreadViewProps {
  scopeKey: string;
  projectKey: string | null;
  agent: AiAgent;
  agents: AiAgent[];
  states: Map<number, ChatAgentState>;
  threadId: string | null;
  // The text typed into a new chat so far, kept by the workspace across agent picks.
  newChatDraft: { current: string };
  onThreadCreated: (threadId: string) => void;
  onNewChat: (agentId: number) => void;
  onOpenList: () => void;
  compact: boolean;
  onArtifact: (artifact: Artifact) => void;
  artifactOpen: boolean;
  onToggleArtifact: () => void;
  hasArtifact: boolean;
}

// One open conversation: the header, the transcript (or, before the first message, who
// the new chat is with) and the composer. Remounted (see the `key` ChatWorkspace gives
// it) whenever the agent or the thread changes, so none of this has to reset its own
// state by hand. The composer keeps its place in the tree between the new-chat layout
// (centered, claude.ai-style) and the conversation (docked at the bottom), so what was
// typed and the model picked survive the first send.
export default function ChatThreadView({
  scopeKey,
  projectKey,
  agent,
  agents,
  states,
  threadId,
  newChatDraft,
  onThreadCreated,
  onNewChat,
  onOpenList,
  compact,
  onArtifact,
  artifactOpen,
  onToggleArtifact,
  hasArtifact,
}: ChatThreadViewProps) {
  const t = useTranslations('chatWorkspace');
  const plan = usePlanChat({
    scopeKey,
    agent,
    threadId,
    onThreadCreated,
    // The composer checks the agent's chat limit before sending; this catches the race
    // where two sends (two tabs) both passed it, so the one that lost is explained.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error(
          t('composer.concurrencyLimit', { agent: agent.name, limit: agent.maxConcurrentChats }),
        );
      }
    },
  });
  const [model, setModel] = useState<{ model: string | null; thinkingLevel: string | null }>({
    model: null,
    thinkingLevel: null,
  });
  const state = states.get(agent.id);
  const empty = !plan.restoring && !plan.restoreFailed && plan.messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        scopeKey={scopeKey}
        projectKey={projectKey}
        agent={agent}
        agents={agents}
        states={states}
        threadId={threadId}
        messages={plan.messages}
        onOpenList={onOpenList}
        onNewChat={onNewChat}
        compact={compact}
        artifactOpen={artifactOpen}
        onToggleArtifact={onToggleArtifact}
        hasArtifact={hasArtifact}
      />
      {plan.restoreFailed ? (
        <ChatRestoreError onRetry={() => void plan.retryRestore()} />
      ) : empty ? (
        <ChatNewChatIntro agent={agent} agents={agents} states={states} onPick={onNewChat} />
      ) : (
        <ChatMessageList
          plan={plan}
          agent={agent}
          agentOnline={state?.online ?? true}
          projectKey={projectKey}
          threadId={threadId}
          onShowArtifact={onArtifact}
        />
      )}
      <ChatComposer
        scopeKey={scopeKey}
        agent={agent}
        threadId={threadId}
        projectKey={projectKey}
        docked={!empty}
        draft={threadId == null ? newChatDraft : undefined}
        busy={plan.busy}
        model={model.model}
        thinkingLevel={model.thinkingLevel}
        onModelChange={(next, thinkingLevel) => setModel({ model: next, thinkingLevel })}
        onSend={(text, options, metadata) => void plan.send(text, options, metadata)}
        onStop={() => void plan.stop()}
        onNewChat={() => onNewChat(agent.id)}
        onRetryLast={() => void plan.regenerate()}
        onUndo={plan.undo}
      />
      {empty && <div aria-hidden className="flex-1" />}
    </div>
  );
}
