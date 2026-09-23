'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { showChatVersion } from '@/lib/api/endpoints/agentChat';
import { ApiError } from '@/lib/api/core/client';
import { PlanChatTransport } from '../../services/planChatTransport';
import { useChatThread } from '../../hooks/useChatThread';
import type { Artifact } from '../../utils/artifacts';
import { toUIMessage, type PlanUIMessage } from '../../utils/chatMessages';
import ChatHeader from './ChatHeader';
import ChatMessageList from './ChatMessageList';
import ChatComposer from './ChatComposer';

export interface ChatThreadViewProps {
  scopeKey: string;
  projectKey: string | null;
  agent: AiAgent;
  threadId: string | null;
  onThreadCreated: (threadId: string) => void;
  onNewChat: () => void;
  onOpenList: () => void;
  compact: boolean;
  onArtifact: (artifact: Artifact) => void;
  artifactOpen: boolean;
  onToggleArtifact: () => void;
  hasArtifact: boolean;
}

// One open conversation: its transcript restored from the API, the live AI SDK chat
// state layered on top of it, the header, the message list and the composer. Remounted
// (see the `key` ChatWorkspace gives it) whenever the agent or the thread changes, so
// none of this has to reset its own state by hand.
export default function ChatThreadView({
  scopeKey,
  projectKey,
  agent,
  threadId,
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
  const thread = useChatThread(scopeKey, agent.id, threadId);
  const transport = useMemo(() => new PlanChatTransport(scopeKey, agent.id), [scopeKey, agent.id]);
  const resumedRef = useRef(false);

  const chat = useChat<PlanUIMessage>({
    id: threadId ?? `new-${agent.id}`,
    transport,
    messages: [],
    onData: (part) => {
      if (part.type === 'data-turn') {
        const data = part.data as { threadId: string };
        onThreadCreated(data.threadId);
      }
    },
    // The composer already checks the agent's chat concurrency limit before sending;
    // this only catches the rare race where two sends (e.g. two tabs) both pass that
    // check before either reaches the server, so the send that actually loses is still
    // explained rather than failing silently.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error(
          t('composer.concurrencyLimit', { agent: agent.name, limit: agent.maxConcurrentChats }),
        );
      }
    },
  });

  const [restored, setRestored] = useState(threadId == null);

  useEffect(() => {
    if (restored || thread.isLoading) return;
    transport.threadId = threadId;
    chat.setMessages(thread.messages);
    if (thread.activeAnswer && !resumedRef.current) {
      resumedRef.current = true;
      transport.resume = {
        messageId: thread.activeAnswer.messageId,
        agentId: thread.activeAnswer.agentId ?? agent.id,
      };
      void chat.resumeStream();
    }
    setRestored(true);
    // Runs once the transcript arrives; chat/transport are stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.isLoading, thread.messages, thread.activeAnswer, restored]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        scopeKey={scopeKey}
        projectKey={projectKey}
        agent={agent}
        threadId={threadId}
        messages={chat.messages}
        onOpenList={onOpenList}
        compact={compact}
        artifactOpen={artifactOpen}
        onToggleArtifact={onToggleArtifact}
        hasArtifact={hasArtifact}
      />
      <ChatMessageList
        messages={chat.messages}
        status={chat.status}
        agent={agent}
        loading={!restored}
        hasOlder={thread.hasOlder}
        loadingOlder={thread.loadingOlder}
        onLoadOlder={thread.loadOlder}
        onRegenerate={(messageId) => chat.regenerate({ messageId })}
        onEdit={(index, text) => {
          chat.setMessages((messages) => messages.slice(0, index));
          void chat.sendMessage({ text });
        }}
        onReply={(text) => void chat.sendMessage({ text })}
        onShowArtifact={onArtifact}
        onSwitchVersion={async (messageId) => {
          if (!threadId) return;
          await showChatVersion(threadId, Number(messageId));
          const page = await thread.refetch();
          if (page.data) chat.setMessages(page.data.items.map(toUIMessage));
        }}
        projectKey={projectKey}
        threadId={threadId}
      />
      <ChatComposer
        scopeKey={scopeKey}
        agent={agent}
        threadId={threadId}
        projectKey={projectKey}
        status={chat.status}
        onSend={(text, options) => void chat.sendMessage({ text }, { body: options })}
        onStop={() => void chat.stop()}
        onNewChat={onNewChat}
        onRetryLast={() => chat.regenerate()}
        onUndo={() => {
          const index = chat.messages.findLastIndex((message) => message.role === 'user');
          if (index === -1) return false;
          chat.setMessages((messages) => messages.slice(0, index));
          return true;
        }}
      />
    </div>
  );
}
