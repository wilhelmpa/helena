'use client';

import WebLinkScope from '@/components/common/WebLinkScope';
import Orb from '@/components/helena/Orb';
import { useAccountPreferences } from '@/services/preferences.service';
import { useAgentStatus } from '@/utils/helenaStatus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDisplayName } from '@/context/displayName';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { ApiError } from '@/lib/api/core/client';
import { usePlanChat } from '../../hooks/usePlanChat';
import { useChatFollowups } from '../../hooks/useChatFollowups';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import { useChatSummary } from '../../hooks/useChatSummary';
import type { PlanSendOptions } from '../../services/planChatTransport';
import type { PlanChatMetadata } from '../../utils/chatMessages';
import { uuid } from '@/utils/uuid';
import type { ChatAgentState } from '../../utils/agentPresence';
import type { Artifact } from '../../utils/artifacts';
import ChatHeader from './ChatHeader';
import ChatDockBar from './ChatDockBar';
import { dockLine } from '../../utils/dockLine';
import { useChatDock } from '@/context/chatDock';
import ChatMessageList from './ChatMessageList';
import ChatComposer from '@/components/helena/Composer';
import ChatNewChatIntro from './ChatNewChatIntro';
import { HomeChatActivityCards, HomeChatHero } from './HomeChatLanding';
import ChatRestoreError from './ChatRestoreError';
import {
  activeTool,
  busyElsewhere,
  composerActivity,
  pendingChoices,
} from '../../utils/composerActivity';
import { agentDisplayName } from '../../utils/agentChip';
import { useReadAll } from '../../hooks/useReadAll';
import { messageText } from '../../utils/chatMessages';
import { answerToRead } from '../../utils/readAloud';
import { speak } from '@/features/voice/browser/speak';
import { useVoice } from '@/features/voice/hooks/useVoice';
import { useConversation } from '@/features/voice/hooks/useConversation';
import { useVoiceProblem } from '@/features/voice/hooks/useVoiceProblem';
import type { QueuedMessage } from './ChatComposerQueue';
import {
  HOME_ACTIVE_STATUSES,
  useHomeActiveActivity,
} from '@/features/home/services/homeKpis.service';

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
  onActivity: (threadId: string) => void;
  onThreadDeleted: (threadId: string) => void;
  onNewChat: (agentId: number) => void;
  onArtifact: (artifact: Artifact) => void;
  artifactOpen: boolean;
  onToggleArtifact: () => void;
  hasArtifact: boolean;
  // Mounted as the chat page (its bar goes into the app header), not in the tool panel.
  inPage?: boolean;
  pageContext?: { projectKey: string | null; path: string };
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
  onActivity,
  onThreadDeleted,
  onNewChat,
  onArtifact,
  artifactOpen,
  onToggleArtifact,
  hasArtifact,
  inPage = false,
  pageContext,
}: ChatThreadViewProps) {
  const t = useTranslations('chatWorkspace');
  const appName = useDisplayName();
  const motionEnabled = useAccountPreferences().homeDashboard.chatAnimation !== false;
  // The events of the answer that say an instruction was taken over reach the follow-up
  // state below, which needs the chat this creates.
  const eventSink = useRef<(event: AgUiEvent) => void>(undefined);
  const plan = usePlanChat({
    scopeKey,
    agent,
    threadId,
    onThreadCreated,
    onEvent: (event) => eventSink.current?.(event),
    pageContext,
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
  const followups = useChatFollowups({
    scopeKey,
    agentId: agent.id,
    messages: plan.messages,
    busy: plan.busy,
    followAnswer: plan.followAnswer,
  });
  const onFollowupEvent = followups.onEvent;
  useEffect(() => {
    eventSink.current = onFollowupEvent;
  }, [onFollowupEvent]);
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
  // Behind another tab of the panel the chat is its bar at the bottom (Auftrag 116): no
  // header of its own, the transcript only while the bar is open.
  const dock = useChatDock();
  const homeLanding = !dock && projectKey === null && empty && (inPage || pageContext != null);
  const activity = composerActivity(plan.messages, plan.status, state?.online ?? true);
  const tool = activeTool(plan.messages, plan.status);
  const choices = activity === 'answered' ? pendingChoices(plan.messages) : null;
  const lastMessageId = plan.messages.at(-1)?.id ?? null;
  const lastMessageRole = plan.messages.at(-1)?.role ?? null;
  useEffect(() => {
    if (!threadId || !lastMessageId) return;
    if (
      plan.status === 'submitted' ||
      plan.status === 'streaming' ||
      (plan.status === 'ready' && lastMessageRole === 'assistant')
    ) {
      onActivity(threadId);
    }
  }, [threadId, lastMessageId, lastMessageRole, plan.status, onActivity]);
  // A local model fell back to the configured one on the last answer: the chip says who
  // really answered (owner, 28.09.).
  const lastAnswer = plan.messages.findLast((message) => message.role === 'assistant');
  const answeredBy = lastAnswer?.metadata?.localFallback
    ? (lastAnswer.metadata.model ?? null)
    : null;
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
  // How the question sent last in this session was given: a spoken one is answered aloud.
  const lastQuestionVia = useRef<'voice' | null>(null);
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
    tool,
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
        lastQuestionVia.current = options.via ?? null;
        void plan.send(text, options, {});
      }
    },
    onProblem: reportVoice,
  });
  // The agent answering or running somewhere else right now (the same "working" the Home
  // masthead counts — a question still waiting for a runner is not work).
  const feed = useHomeActiveActivity();
  const workingElsewhere = (feed.data?.items ?? []).some(
    (entry) =>
      entry.agent?.id === agent.id &&
      HOME_ACTIVE_STATUSES.has(entry.status) &&
      (threadId == null || entry.threadId !== threadId),
  );
  // This chat's own state only: what the agent does elsewhere (other chats, runs, the load
  // of the local model) never moves this orb (owner, 28.09.).
  const orbStatus = useAgentStatus(agent.id, {
    chatId: threadId,
    run: null,
    chat: activity === 'answered' && recentDoneId !== lastMessageId ? null : activity,
    voicePhase: conversation.phase,
    tool,
    awaitingChoice: choices != null,
    runtimeStatus: state?.online === false ? 'offline' : agent.runtimeState.status,
  });
  const showAnswerOrb = orbStatus !== 'idle' || conversation.phase !== 'off';
  const orbVisible = !plan.restoreFailed && (empty || showAnswerOrb);
  const talking = conversation.phase !== 'off';
  useEffect(() => {
    if (conversation.state.notice !== 'echo') return;
    reportVoice('echo');
    conversation.dismissNotice();
  }, [conversation, reportVoice]);

  // A complete answer is read aloud when it answers a question that was spoken, or in a chat
  // where "read everything" is on (not one that was stopped or failed) — never one to a typed
  // question otherwise, and not while a conversation reads it already. With the voice the
  // conversation uses (Helena's local voice, the browser's only where that is unreachable).
  const [readAll, setReadAll] = useReadAll(threadId);
  const voice = useVoice();
  const wasBusy = useRef(false);
  useEffect(() => {
    if (plan.busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    const text = answerToRead({
      messages: plan.messages,
      readAll,
      talking,
      lastQuestionVia: lastQuestionVia.current,
    });
    if (text && lastQuestionVia.current !== 'voice') speak(text, { speaker: voice.speaker, speed: voice.speed });
  }, [plan.busy, plan.messages, readAll, talking, voice.speaker, voice.speed]);

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
    lastQuestionVia.current = next!.options.via ?? null;
    if (next!.options.via === 'voice') conversation.followReply();
    void plan.send(next!.text, next!.options, next!.metadata);
  }, [plan, queue, queuePaused, conversation]);

  return (
    <WebLinkScope projectKey={scopeKey.startsWith('team:') ? null : scopeKey}>
      <div className="flex h-full min-h-0 flex-col">
        {dock && (
          <ChatDockBar
            dock={dock}
            agentName={agentDisplayName(agent, appName)}
            lastAnswer={lastAnswer ? dockLine(messageText(lastAnswer)) : null}
            status={orbStatus}
          />
        )}
        {!homeLanding && !dock && (
          <ChatHeader
            scopeKey={scopeKey}
            projectKey={projectKey}
            agent={agent}
            threadId={threadId}
            messages={plan.messages}
            onNewChat={onNewChat}
            onDeleted={onThreadDeleted}
            artifactOpen={artifactOpen}
            onToggleArtifact={onToggleArtifact}
            hasArtifact={hasArtifact}
            inPage={inPage}
          />
        )}
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          hidden={dock != null && !dock.expanded}
        >
          {plan.restoreFailed ? (
            <ChatRestoreError onRetry={() => void plan.retryRestore()} />
          ) : homeLanding ? (
            <HomeChatHero
              showTitle={inPage}
              orb={
                <Orb
                  state={orbStatus}
                  size="large"
                  motionEnabled={motionEnabled}
                  voicePhase={conversation.phase}
                  micStream={conversation.micStream}
                  outputAnalyser={conversation.outputAnalyser}
                />
              }
            />
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
              scopeKey={scopeKey}
              showOrb={showAnswerOrb}
            />
          )}
          {!homeLanding && (
            <div
              aria-hidden={!orbVisible}
              className="pointer-events-none absolute z-10 aspect-square transition-[top,left,transform,width,opacity] duration-[600ms] ease-in-out motion-reduce:transition-none"
              style={{
                width: empty ? (pageContext ? '12rem' : 'min(20rem, 55vw)') : '7rem',
                left: empty ? '50%' : 'max(1rem, calc((100% - 48rem) / 2))',
                top: empty ? 'calc(50% - 1.5rem)' : 'calc(100% - 3.5rem)',
                transform: empty ? 'translate(-50%, -50%)' : 'translate(0, -50%)',
                opacity: orbVisible ? 1 : 0,
                ['--orb-size' as string]: '100%',
              }}
            >
              <Orb
                state={orbStatus}
                size="large"
                motionEnabled={motionEnabled}
                voicePhase={conversation.phase}
                micStream={conversation.micStream}
                outputAnalyser={conversation.outputAnalyser}
              />
            </div>
          )}
        </div>
        {(!dock || dock.expanded) &&
          busyElsewhere(activity, workingElsewhere ? 'running' : null) && (
            <p className="ds-chat-busy-note" role="status">
              {t('composer.busyElsewhere', { agent: agentDisplayName(agent, appName) })}
            </p>
          )}
        <ChatComposer
          homeLanding={homeLanding}
          scopeKey={scopeKey}
          agent={agent}
          agents={agents}
          states={states}
          motionEnabled={motionEnabled}
          activity={activity}
          queue={queue}
          queuePaused={queuePaused}
          steer={followups.canSteer ? { modes: followups.modes, send: followups.send } : undefined}
          onQueue={(text, options, metadata) => {
            setQueuePaused(false);
            setQueue((current) => [...current, { id: uuid(), text, options, metadata }]);
          }}
          onRemoveQueued={(id) => setQueue((current) => current.filter((item) => item.id !== id))}
          choices={choices}
          contextTokens={summary.data?.contextTokens}
          readAll={readAll}
          onReadAllChange={setReadAll}
          conversation={conversation}
          threadId={threadId}
          projectKey={projectKey}
          dockSheet={pageContext != null}
          typeToFocus={inPage}
          draft={threadId == null ? newChatDraft : undefined}
          busy={plan.busy}
          model={model.model}
          thinkingLevel={model.thinkingLevel}
          onModelChange={(next, thinkingLevel) =>
            setModel({ model: next, thinkingLevel, chosen: true })
          }
          onSend={(text, options, metadata) => {
            setQueuePaused(false);
            if (threadId) onActivity(threadId);
            lastQuestionVia.current = options.via ?? null;
            if (options.via === 'voice') conversation.followReply();
            void plan.send(text, options, metadata);
          }}
          onStop={() => void plan.stop()}
          onNewChat={() => onNewChat(agent.id)}
          onPickAgent={onNewChat}
          answeredBy={answeredBy}
          onRetryLast={() => void plan.regenerate()}
          onReconnect={() => void plan.reconnect()}
          onContinue={() => void plan.send(t('interrupted.continuePrompt'), { agentId: agent.id })}
          onResend={() => void plan.retrySend()}
          onUndo={plan.undo}
          onEditLast={lastOwnMessage ? () => setEditingId(lastOwnMessage.id) : undefined}
        />
        {homeLanding && inPage && <HomeChatActivityCards />}
      </div>
    </WebLinkScope>
  );
}
