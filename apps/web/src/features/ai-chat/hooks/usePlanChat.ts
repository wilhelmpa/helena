'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { showChatVersion } from '@/lib/api/endpoints/agentChat';
import { qk } from '@/services/queryKeys';
import { uuid } from '@/utils/uuid';
import { PlanChatTransport, type PlanSendOptions } from '../services/planChatTransport';
import {
  mergeNewestPage,
  mergeOlderPage,
  messageText,
  toUIMessage,
  type PlanChatMetadata,
  type PlanUIMessage,
} from '../utils/chatMessages';
import { useChatThread } from './useChatThread';

const serverId = (id: string | undefined) => (id != null && /^\d+$/.test(id) ? Number(id) : null);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One open conversation's live state: the AI SDK chat over Plan's transport, restored
// from the thread's stored transcript when the view opens on one, with a running answer
// picked up where it is — and every action the view offers on it.
//
// The view is mounted once per conversation (see ChatWorkspace's key), so `threadId` is
// read once: the thread to restore. A new chat gets its thread id from its first
// answer (the `turn` data part) and reports it through `onThreadCreated` without the
// view being remounted, so the answer keeps streaming into the same chat.
export function usePlanChat({
  scopeKey,
  agent,
  threadId,
  onThreadCreated,
  onError,
}: {
  scopeKey: string;
  agent: AiAgent;
  threadId: string | null;
  onThreadCreated: (threadId: string) => void;
  onError: (error: Error) => void;
}) {
  const client = useQueryClient();
  const [initialThreadId] = useState(threadId);
  const thread = useChatThread(scopeKey, agent.id, initialThreadId);
  const transport = useMemo(() => new PlanChatTransport(scopeKey, agent.id), [scopeKey, agent.id]);
  const [chatId] = useState(() => initialThreadId ?? `new-${agent.id}-${uuid()}`);
  const [restored, setRestored] = useState(initialThreadId == null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const latest = useRef({ onThreadCreated, onError });
  latest.current = { onThreadCreated, onError };
  // The chat's own setter and status, for callbacks the chat itself calls (onData,
  // onFinish), which are created before it.
  const chatRef = useRef<{
    setMessages: (update: (messages: PlanUIMessage[]) => PlanUIMessage[]) => void;
    status: string;
  } | null>(null);

  // After an answer ends, the server's copy of the newest page replaces the streamed
  // one: it carries what the stream does not — the model that answered, token counts,
  // the duration, the versions of each turn. The answer's final state lands a moment
  // after its last event, so an answer still stored as running is looked at again.
  const refreshNewest = useCallback(async () => {
    const id = transport.threadId;
    if (!id) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(attempt === 0 ? 500 : 1500);
      const page = await thread.fetchPageOf(id, 0).catch(() => null);
      if (!page) return;
      if (page.activeAnswer) continue;
      if (chatRef.current?.status !== 'ready') return;
      chatRef.current.setMessages((current) =>
        mergeNewestPage(current, page.items.map(toUIMessage)),
      );
      return;
    }
  }, [transport, thread]);

  const chat = useChat<PlanUIMessage>({
    id: chatId,
    transport,
    // A runner batch carries several deltas; they land as one render, not one each.
    throttle: 50,
    onData: (part) => {
      if (part.type !== 'data-turn') return;
      const turn = part.data as { threadId: string; questionId: string; clientId: string };
      // The question now has the server's id: editing it, answering it again and
      // continuing after it all name it by that id.
      chatRef.current?.setMessages((messages) =>
        messages.map((message) =>
          message.id === turn.clientId ? { ...message, id: turn.questionId } : message,
        ),
      );
      latest.current.onThreadCreated(turn.threadId);
      void client.invalidateQueries({ queryKey: qk.anyChatList });
    },
    onFinish: ({ message, isAbort }) => {
      void client.invalidateQueries({ queryKey: qk.anyChatList });
      if (isAbort || message.metadata?.interrupted) return;
      void refreshNewest().then(() => {
        // The chat's own record carries what the answer changed: its context size, the
        // session the runner bound, the title.
        if (transport.threadId) {
          void client.invalidateQueries({ queryKey: qk.chat(transport.threadId) });
        }
      });
    },
    onError: (error) => latest.current.onError(error),
  });
  chatRef.current = { setMessages: chat.setMessages, status: chat.status };

  // The stored transcript, once, when the view opened on a thread; an answer still
  // being produced is followed from its first event (it replaces its stored part).
  useEffect(() => {
    if (restored || !thread.initial) return;
    transport.threadId = initialThreadId;
    chat.setMessages(thread.initial.items.map(toUIMessage));
    setNextPage(thread.initial.nextPage);
    const active = thread.initial.activeAnswer;
    if (active) {
      transport.resume = {
        agentId: active.agentId ?? agent.id,
        messageId: active.messageId,
        createdAt: active.createdAt,
      };
      void chat.resumeStream();
    }
    setRestored(true);
    // Runs once the transcript arrives; chat and transport are stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.initial, restored]);

  const busy = chat.status === 'submitted' || chat.status === 'streaming';

  const send = useCallback(
    (text: string, options: PlanSendOptions, metadata: PlanChatMetadata = {}) =>
      chat.sendMessage(
        { text, metadata: { createdAt: new Date().toISOString(), ...metadata } },
        { body: options },
      ),
    [chat],
  );

  // Stops the answer on the server; its stream then ends by itself with what was
  // written. Should the stop not come through, the stream is closed after a while
  // anyway, so the composer never stays stuck on "stop".
  const stop = useCallback(async () => {
    if (!transport.active) {
      await chat.stop();
      return;
    }
    await transport.cancel().catch(() => undefined);
    await sleep(5000);
    if (chatRef.current?.status === 'streaming' || chatRef.current?.status === 'submitted') {
      await chat.stop();
    }
  }, [chat, transport]);

  const regenerate = useCallback(
    (messageId?: string) => chat.regenerate(messageId ? { messageId } : undefined),
    [chat],
  );

  // An edit is a new version of the question, sent from the same parent: the turns after
  // it leave the view, and the answer to the edit takes their place.
  const edit = useCallback(
    (index: number, text: string) => {
      const parentId = serverId(chat.messages[index - 1]?.id);
      chat.setMessages((messages) => messages.slice(0, index));
      return send(text, { agentId: agent.id, parentId });
    },
    [chat, send, agent.id],
  );

  // Follows an answer whose stream was lost again, from its first event.
  const reconnect = useCallback(() => {
    const last = chat.messages.at(-1);
    const messageId = serverId(last?.id);
    if (last?.role !== 'assistant' || messageId == null) return;
    transport.resume = { agentId: last.metadata?.agentId ?? agent.id, messageId };
    return chat.resumeStream();
  }, [chat, transport, agent.id]);

  // A send that failed before the server stored it is sent again as it was; one that
  // was stored is answered again.
  const retrySend = useCallback(() => {
    const last = chat.messages.at(-1);
    if (last?.role !== 'user') return regenerate();
    if (serverId(last.id) != null) return regenerate();
    chat.setMessages((messages) => messages.slice(0, -1));
    return send(messageText(last), { agentId: agent.id }, last.metadata);
  }, [chat, regenerate, send, agent.id]);

  const switchVersion = useCallback(
    async (messageId: string) => {
      const id = transport.threadId;
      if (!id) return;
      await showChatVersion(id, Number(messageId));
      const page = await thread.fetchPageOf(id, 0);
      chat.setMessages(page.items.map(toUIMessage));
      setNextPage(page.nextPage);
    },
    [chat, thread, transport],
  );

  const loadOlder = useCallback(async () => {
    const id = transport.threadId;
    if (nextPage == null || !id || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await thread.fetchPageOf(id, nextPage);
      chat.setMessages((messages) => mergeOlderPage(messages, page.items.map(toUIMessage)));
      setNextPage(page.nextPage);
    } finally {
      setLoadingOlder(false);
    }
  }, [chat, thread, transport, nextPage, loadingOlder]);

  // `/undo`: the last exchange leaves the view; nothing is sent, so it only becomes the
  // thread's history once the next message continues from before it.
  const undo = useCallback((): boolean => {
    const index = chat.messages.findLastIndex((message) => message.role === 'user');
    if (index === -1) return false;
    chat.setMessages((messages) => messages.slice(0, index));
    return true;
  }, [chat]);

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    busy,
    restoring: !restored,
    restoreFailed: thread.isError && !restored,
    retryRestore: thread.retry,
    hasOlder: nextPage != null,
    loadingOlder,
    send,
    stop,
    regenerate,
    edit,
    reconnect,
    retrySend,
    switchVersion,
    loadOlder,
    undo,
  };
}

export type PlanChat = ReturnType<typeof usePlanChat>;
