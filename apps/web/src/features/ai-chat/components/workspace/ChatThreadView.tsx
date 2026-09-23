'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { ApiError } from '@/lib/api/core/client';
import { usePlanChat } from '../../hooks/usePlanChat';
import { useChatSummary } from '../../hooks/useChatSummary';
import type { PlanSendOptions } from '../../services/planChatTransport';
import type { PlanChatMetadata } from '../../utils/chatMessages';
import { uuid } from '@/utils/uuid';
import type { ChatAgentState } from '../../utils/agentPresence';
import type { Artifact } from '../../utils/artifacts';
import ChatHeader from './ChatHeader';
import ChatMessageList from './ChatMessageList';
import ChatComposer from './ChatComposer';
import ChatNewChatIntro from './ChatNewChatIntro';
import ChatRestoreError from './ChatRestoreError';
import { activeTool, composerActivity, pendingChoices } from '../../utils/composerActivity';
import type { QueuedMessage } from './ChatQueuedMessages';

type Queued = QueuedMessage & { options: PlanSendOptions; metadata: PlanChatMetadata };

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
  onThreadDeleted: (threadId: string) => void;
  onNewChat: (agentId: number) => void;
  onOpenList: () => void;
  compact: boolean;
  onArtifact: (artifact: Artifact) => void;
  artifactOpen: boolean;
  onToggleArtifact: () => void;
  hasArtifact: boolean;
  // Mounted as the chat page (its bar goes into the app header), not in the tool panel.
  inPage?: boolean;
}

// One open conversation: the header, the transcript (or, before the first message, a
// quiet line saying who the new chat is with) and the composer at the bottom, which
// also shows and steers the answer. Remounted (see the `key` ChatWorkspace gives it)
// whenever the agent or the thread changes, so none of this has to reset its own state
// by hand.
export default function ChatThreadView({
  scopeKey,
  projectKey,
  agent,
  agents,
  states,
  threadId,
  newChatDraft,
  onThreadCreated,
  onThreadDeleted,
  onNewChat,
  onOpenList,
  compact,
  onArtifact,
  artifactOpen,
  onToggleArtifact,
  hasArtifact,
  inPage = false,
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
  const [model, setModel] = useState<{
    model: string | null;
    thinkingLevel: string | null;
    // Set by the member (the picker or /model); until then a reopened chat follows the
    // model it was last sent with.
    chosen: boolean;
  }>({ model: null, thinkingLevel: null, chosen: false });
  const summary = useChatSummary(threadId);
  useEffect(() => {
    const data = summary.data;
    if (!data || model.chosen) return;
    if (data.model !== model.model || data.thinkingLevel !== model.thinkingLevel) {
      setModel({ model: data.model, thinkingLevel: data.thinkingLevel, chosen: false });
    }
  }, [summary.data, model]);
  const state = states.get(agent.id);
  const empty = !plan.restoring && !plan.restoreFailed && plan.messages.length === 0;
  const activity = composerActivity(plan.messages, plan.status, state?.online ?? true);

  // What is written while an answer is still coming waits here and goes out in order
  // once the agent is done (old-chat parity). An answer that failed holds the queue:
  // nothing more is sent on its own until the member sends again.
  const [queue, setQueue] = useState<Queued[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  useEffect(() => {
    if (activity === 'failed' || activity === 'sendFailed') setQueuePaused(true);
  }, [activity]);
  // One send per turn: between handing a message to the chat and the chat reporting it
  // busy there is a render in which it still looks idle; the next status change (the
  // send taken, or refused) opens the gate again.
  const dispatching = useRef(false);
  useEffect(() => {
    dispatching.current = false;
  }, [plan.status]);
  useEffect(() => {
    if (dispatching.current || plan.busy || plan.restoring || queuePaused) return;
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    dispatching.current = true;
    setQueue(rest);
    void plan.send(next!.text, next!.options, next!.metadata);
  }, [plan, queue, queuePaused]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        scopeKey={scopeKey}
        projectKey={projectKey}
        agent={agent}
        threadId={threadId}
        messages={plan.messages}
        onOpenList={onOpenList}
        onNewChat={onNewChat}
        onDeleted={onThreadDeleted}
        compact={compact}
        artifactOpen={artifactOpen}
        onToggleArtifact={onToggleArtifact}
        hasArtifact={hasArtifact}
        inPage={inPage}
      />
      {plan.restoreFailed ? (
        <ChatRestoreError onRetry={() => void plan.retryRestore()} />
      ) : empty ? (
        <ChatNewChatIntro agent={agent} />
      ) : (
        <ChatMessageList
          plan={plan}
          agent={agent}
          projectKey={projectKey}
          threadId={threadId}
          onShowArtifact={onArtifact}
        />
      )}
      <ChatComposer
        scopeKey={scopeKey}
        agent={agent}
        agents={agents}
        states={states}
        activity={activity}
        tool={activeTool(plan.messages, plan.status)}
        queue={queue}
        queuePaused={queuePaused}
        onQueue={(text, options, metadata) => {
          setQueuePaused(false);
          setQueue((current) => [...current, { id: uuid(), text, options, metadata }]);
        }}
        onRemoveQueued={(id) => setQueue((current) => current.filter((item) => item.id !== id))}
        choices={activity === 'answered' ? pendingChoices(plan.messages) : null}
        contextTokens={summary.data?.contextTokens}
        threadId={threadId}
        projectKey={projectKey}
        draft={threadId == null ? newChatDraft : undefined}
        busy={plan.busy}
        model={model.model}
        thinkingLevel={model.thinkingLevel}
        onModelChange={(next, thinkingLevel) =>
          setModel({ model: next, thinkingLevel, chosen: true })
        }
        onSend={(text, options, metadata) => {
          setQueuePaused(false);
          void plan.send(text, options, metadata);
        }}
        onStop={() => void plan.stop()}
        onNewChat={() => onNewChat(agent.id)}
        onPickAgent={onNewChat}
        onRetryLast={() => void plan.regenerate()}
        onReconnect={() => void plan.reconnect()}
        onContinue={() => void plan.send(t('interrupted.continuePrompt'), { agentId: agent.id })}
        onResend={() => void plan.retrySend()}
        onUndo={plan.undo}
      />
    </div>
  );
}
