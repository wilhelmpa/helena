'use client';

import WebLinkScope from '@/components/common/WebLinkScope';
import AgentStatusOrb from '@/components/common/agent-chat/AgentStatusOrb';
import { useAccountPreferences } from '@/services/preferences.service';
import { agentOrbState, chatOrbState } from '@/utils/agentStatusOrb';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useAutoSpeak } from '../../hooks/useAutoSpeak';
import { messageText } from '../../utils/chatMessages';
import { speak } from '@/features/voice/browser/speak';
import { useConversation } from '@/features/voice/hooks/useConversation';
import { useVoiceProblem } from '@/features/voice/hooks/useVoiceProblem';
import type { QueuedMessage } from './ChatComposerQueue';

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
// selected agent's status and introduction) and the composer at the bottom, which
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
  const motionEnabled = useAccountPreferences().homeDashboard.chatAnimation !== false;
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
  // The member's own message open for editing, if any (the pencil under it, or ↑ in the
  // empty composer for the last one).
  const [editingId, setEditingId] = useState<string | null>(null);
  const lastOwnMessage = plan.messages.findLast((message) => message.role === 'user');
  const state = states.get(agent.id);
  const empty = !plan.restoring && !plan.restoreFailed && plan.messages.length === 0;
  const activity = composerActivity(plan.messages, plan.status, state?.online ?? true);
  const tool = activeTool(plan.messages, plan.status);
  const choices = activity === 'answered' ? pendingChoices(plan.messages) : null;
  const lastMessageId = plan.messages.at(-1)?.id ?? null;
  const [recentDoneId, setRecentDoneId] = useState<string | null>(null);
  const previousActivity = useRef(activity);
  useEffect(() => {
    const previous = previousActivity.current;
    previousActivity.current = activity;
    if (
      activity !== 'answered' ||
      !lastMessageId ||
      !['thinking', 'writing', 'queued'].includes(previous)
    )
      return;
    const show = setTimeout(() => setRecentDoneId(lastMessageId), 0);
    const hide = setTimeout(() => setRecentDoneId(null), 2500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [activity, lastMessageId]);
  const mappedOrbState = chatOrbState(activity, tool, choices != null);
  const orbState =
    mappedOrbState === 'done' && recentDoneId !== lastMessageId ? null : mappedOrbState;

  // What is written while an answer is still coming waits here and goes out in order
  // once the agent is done (old-chat parity). An answer that failed holds the queue:
  // nothing more is sent on its own until the member sends again.
  const [queue, setQueue] = useState<Queued[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  useEffect(() => {
    if (activity === 'failed' || activity === 'sendFailed') setQueuePaused(true);
  }, [activity]);
  // The hands-free conversation (features/voice): what is said is sent like a typed message
  // (waiting its turn while an answer is still coming), and each new answer is read aloud
  // while it streams.
  const reportVoice = useVoiceProblem();
  const voiceMessages = useMemo(
    () =>
      plan.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.role === 'assistant' ? messageText(message) : '',
      })),
    [plan.messages],
  );
  const conversation = useConversation({
    messages: voiceMessages,
    busy: plan.busy,
    queued: queue.length,
    send: (text) => {
      const options: PlanSendOptions = {
        agentId: agent.id,
        model: model.model,
        thinkingLevel: model.thinkingLevel,
        via: 'voice',
      };
      setQueuePaused(false);
      if (plan.busy || queue.length > 0) {
        setQueue((current) => [...current, { id: uuid(), text, options, metadata: {} }]);
      } else {
        void plan.send(text, options, {});
      }
    },
    onProblem: reportVoice,
  });
  const showAnswerOrb = orbState !== null || conversation.phase !== 'off';
  const orbVisible = !plan.restoreFailed && (empty || showAnswerOrb);
  const voiceThinking = conversation.phase === 'thinking' || conversation.phase === 'transcribing';
  const orbVisualState =
    conversation.phase === 'speaking' ||
    conversation.phase === 'listening' ||
    conversation.phase === 'hearing'
      ? 'idle'
      : voiceThinking
        ? orbState === 'tool'
          ? 'tool'
          : 'thinking'
        : empty
          ? agentOrbState(state?.label, agent.runtimeState.status)
          : (orbState ?? 'idle');
  const talking = conversation.phase !== 'off';
  useEffect(() => {
    if (conversation.state.notice !== 'echo') return;
    reportVoice('echo');
    conversation.dismissNotice();
  }, [conversation, reportVoice]);

  // With "read answers aloud" on, an answer is spoken as soon as it is complete (not one that
  // was stopped or failed) — unless a conversation reads it already.
  const [autoSpeak, setAutoSpeak] = useAutoSpeak();
  const wasBusy = useRef(false);
  useEffect(() => {
    if (plan.busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    const last = plan.messages.at(-1);
    if (!autoSpeak || talking || last?.role !== 'assistant') return;
    if (last.metadata?.stopped || last.metadata?.error || last.metadata?.interrupted) return;
    speak(messageText(last));
  }, [plan.busy, plan.messages, autoSpeak, talking]);

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
    <WebLinkScope projectKey={scopeKey.startsWith('team:') ? null : scopeKey}>
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
        <div className="relative flex min-h-0 flex-1 flex-col">
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
              editingId={editingId}
              onEditingChange={setEditingId}
              onShowArtifact={onArtifact}
              showOrb={showAnswerOrb}
            />
          )}
          <div
            aria-hidden={!orbVisible}
            className="pointer-events-none absolute z-10 aspect-square transition-[top,left,transform,width,opacity] duration-[600ms] ease-in-out motion-reduce:transition-none"
            style={{
              width: empty ? 'min(20rem, 55vw)' : '7rem',
              left: empty ? '50%' : 'max(1rem, calc((100% - 48rem) / 2))',
              top: empty ? 'calc(50% - 1.5rem)' : 'calc(100% - 3.5rem)',
              transform: empty ? 'translate(-50%, -50%)' : 'translate(0, -50%)',
              opacity: orbVisible ? 1 : 0,
              ['--orb-size' as string]: '100%',
            }}
          >
            <AgentStatusOrb
              state={orbVisualState}
              size="large"
              online={state?.online ?? !empty}
              motionEnabled={motionEnabled}
              voicePhase={conversation.phase}
              micStream={conversation.micStream}
              outputAnalyser={conversation.outputAnalyser}
            />
          </div>
        </div>
        <ChatComposer
          scopeKey={scopeKey}
          agent={agent}
          agents={agents}
          states={states}
          motionEnabled={motionEnabled}
          activity={activity}
          tool={tool}
          queue={queue}
          queuePaused={queuePaused}
          onQueue={(text, options, metadata) => {
            setQueuePaused(false);
            setQueue((current) => [...current, { id: uuid(), text, options, metadata }]);
          }}
          onRemoveQueued={(id) => setQueue((current) => current.filter((item) => item.id !== id))}
          choices={choices}
          contextTokens={summary.data?.contextTokens}
          autoSpeak={autoSpeak}
          onAutoSpeakChange={setAutoSpeak}
          conversation={conversation}
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
          onEditLast={lastOwnMessage ? () => setEditingId(lastOwnMessage.id) : undefined}
        />
      </div>
    </WebLinkScope>
  );
}
