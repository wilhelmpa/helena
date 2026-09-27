'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { dayKey } from '@/utils/dates';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentStatusOrb from '@/components/common/agent-chat/AgentStatusOrb';
import type { AgentOrbState, VoiceOrbAudio } from '@/utils/agentStatusOrb';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerProvider,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '@/components/ui/message-scroller';
import type { PlanChat } from '../../hooks/usePlanChat';
import type { Artifact } from '../../utils/artifacts';
import type { PlanUIMessage } from '../../utils/chatMessages';
import ChatMessageItem from './ChatMessageItem';
import ChatDaySeparator from './ChatDaySeparator';

// Keeps following an answer to its end unless the reader scrolled. The scroller lets go
// of following when the view moves up without it — which is also what a block that
// shrinks and grows again looks like (a diagram redrawing as its fence completes, the
// answer's footer and the composer's status line changing at its end). Here only the
// reader's own gestures on the transcript (wheel, touch, keys, the scrollbar) count as
// scrolling away; anything else puts the view back at the end. Renders nothing.
function KeepFollowing({
  streaming,
  viewportRef,
}: {
  streaming: boolean;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { scrollToEnd } = useMessageScroller();
  const { end } = useMessageScrollerScrollable();
  const readerScrolled = useRef(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scrolled = () => {
      readerScrolled.current = true;
    };
    const keyScrolled = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home', ' '].includes(event.key)) scrolled();
    };
    // The scrollbar: a press on the viewport itself rather than on a message.
    const barScrolled = (event: PointerEvent) => {
      if (event.target === viewport) scrolled();
    };
    viewport.addEventListener('wheel', scrolled, { passive: true });
    viewport.addEventListener('touchmove', scrolled, { passive: true });
    viewport.addEventListener('keydown', keyScrolled);
    viewport.addEventListener('pointerdown', barScrolled);
    return () => {
      viewport.removeEventListener('wheel', scrolled);
      viewport.removeEventListener('touchmove', scrolled);
      viewport.removeEventListener('keydown', keyScrolled);
      viewport.removeEventListener('pointerdown', barScrolled);
    };
  }, [viewportRef]);

  // Back at the end, by any means, the reader follows again.
  useEffect(() => {
    if (!end) readerScrolled.current = false;
    else if (streaming && !readerScrolled.current) scrollToEnd({ behavior: 'auto' });
  }, [end, streaming, scrollToEnd]);

  // The end of an answer settles over a moment (its footer, the server's copy of it).
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    const ended = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!ended || readerScrolled.current) return;
    const frame = requestAnimationFrame(() => scrollToEnd({ behavior: 'auto' }));
    const later = setTimeout(() => {
      if (!readerScrolled.current) scrollToEnd({ behavior: 'auto' });
    }, 1200);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
    };
  }, [streaming, scrollToEnd]);
  return null;
}

// An answer that has nothing to show yet (no text, reasoning or tool call, no error).
const isEmptyAnswer = (message: PlanUIMessage) =>
  message.role === 'assistant' && message.parts.length === 0 && !message.metadata?.error;

export interface ChatMessageListProps {
  plan: PlanChat;
  agent: AiAgent;
  projectKey: string | null;
  threadId: string | null;
  editingId: string | null;
  onEditingChange: (messageId: string | null) => void;
  onShowArtifact: (artifact: Artifact) => void;
  orbState: AgentOrbState | null;
  online: boolean;
  motionEnabled: boolean;
  conversation: VoiceOrbAudio;
}

// The transcript, in shadcn's MessageScroller: it opens at the newest message, follows
// an answer while it streams as long as the reader stays at the bottom, lets go the
// moment they scroll up to read back (with a button to jump down again), anchors a new
// question near the top so its answer has room, and keeps the reader's place when older
// messages load in above. Centered at a comfortable reading width, the way claude.ai
// reads. The answer orb follows the latest message; detailed status and controls stay at the composer.
export default function ChatMessageList(props: ChatMessageListProps) {
  if (props.plan.restoring) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-hidden px-4 py-6">
        <Skeleton className="ms-auto h-9 w-1/2 rounded-2xl" />
        <Skeleton className="h-20 w-3/4" />
        <Skeleton className="ms-auto h-9 w-2/5 rounded-2xl" />
      </div>
    );
  }
  return <ChatTranscript {...props} />;
}

function ChatTranscript({
  plan,
  agent,
  projectKey,
  threadId,
  editingId,
  onEditingChange,
  onShowArtifact,
  orbState,
  online,
  motionEnabled,
  conversation,
}: ChatMessageListProps) {
  const t = useTranslations('chatWorkspace');
  const { messages, status } = plan;
  // The messages the chat opened with (and older pages loaded later, which land in front
  // of them) are history: only a question sent from here on is a scroll anchor. The
  // scroller brings a new anchor to the top so its answer has room, and would otherwise
  // take every restored question for one still to show and jump back up to it.
  const [history] = useState(() => new Set(messages.map((message) => message.id)));
  const lastHistoryIndex = messages.findLastIndex((message) => history.has(message.id));
  // The callbacks each message gets stay the same while the answer streams, so a
  // finished message does not re-render with every token of the next one.
  const latest = useRef(plan);
  latest.current = plan;
  const edit = useCallback((messageId: string, text: string) => {
    const index = latest.current.messages.findIndex((message) => message.id === messageId);
    if (index >= 0) void latest.current.edit(index, text);
  }, []);
  const switchVersion = useCallback(
    (messageId: string) => void latest.current.switchVersion(messageId),
    [],
  );

  // Older messages load by themselves when the top of the transcript comes into view
  // (old-chat parity); the button stays for keyboards and as the loading indicator.
  const topRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canLoadOlder = plan.hasOlder && !plan.loadingOlder;
  useEffect(() => {
    const node = topRef.current;
    if (!node || !canLoadOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void latest.current.loadOlder();
      },
      { rootMargin: '200px 0px 0px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadOlder]);

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <KeepFollowing
        streaming={status === 'streaming' || status === 'submitted'}
        viewportRef={viewportRef}
      />
      <MessageScroller className="flex-1">
        <MessageScrollerViewport
          ref={viewportRef}
          aria-label={t('messages.transcript')}
          preserveScrollOnPrepend
        >
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 px-4 pt-6 pb-6">
            <div ref={topRef} aria-hidden="true" />
            {plan.hasOlder && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={plan.loadingOlder}
                  onClick={() => void plan.loadOlder()}
                >
                  {plan.loadingOlder ? t('messages.loading') : t('messages.loadOlder')}
                </Button>
              </div>
            )}
            {messages.map((message, index) => {
              if (isEmptyAnswer(message)) return null;
              const at = message.metadata?.createdAt;
              const previousAt = messages
                .slice(0, index)
                .findLast((earlier) => !isEmptyAnswer(earlier))?.metadata?.createdAt;
              const newDay =
                at != null && (previousAt == null || dayKey(previousAt) !== dayKey(at));
              return (
                <Fragment key={message.id}>
                  {newDay ? <ChatDaySeparator at={at} /> : null}
                  <MessageScrollerItem
                    messageId={message.id}
                    scrollAnchor={message.role === 'user' && index > lastHistoryIndex}
                  >
                    <ChatMessageItem
                      message={message}
                      isLast={index === messages.length - 1}
                      status={status}
                      agent={agent}
                      projectKey={projectKey}
                      threadId={threadId}
                      editing={editingId === message.id}
                      onEditingChange={onEditingChange}
                      onEdit={edit}
                      onShowArtifact={onShowArtifact}
                      onSwitchVersion={switchVersion}
                    />
                  </MessageScrollerItem>
                </Fragment>
              );
            })}
            {(orbState || conversation.phase !== 'off') && (
              <div className="flex justify-start py-1">
                <AgentStatusOrb
                  state={
                    conversation.phase === 'speaking' ||
                    conversation.phase === 'listening' ||
                    conversation.phase === 'hearing'
                      ? 'idle'
                      : conversation.phase === 'thinking' || conversation.phase === 'transcribing'
                        ? orbState === 'tool'
                          ? 'tool'
                          : 'thinking'
                        : (orbState ?? 'idle')
                  }
                  size="large"
                  online={online}
                  motionEnabled={motionEnabled}
                  voicePhase={conversation.phase}
                  micStream={conversation.micStream}
                  outputAnalyser={conversation.outputAnalyser}
                />
              </div>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
