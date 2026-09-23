'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAiAgentThreadMessages, type AiChatMessagePage } from '@/lib/api/endpoints/agentChat';
import { qk } from '@/services/queryKeys';
import { toUIMessage, type PlanUIMessage } from '../utils/chatMessages';

// The transcript of one thread, restored the way the workspace shows it: oldest first,
// with older pages loaded on demand as the reader scrolls up. `page` 0 is the newest
// page the API serves (see getThreadMessages on the server); pages already read stay in
// `pages`, newest last, so flattening them in order gives the conversation top to
// bottom. `activeAnswer` names an answer still being produced, for the workspace to
// resume its stream instead of showing it as if it had already finished.
export function useChatThread(scopeKey: string, agentId: number | null, threadId: string | null) {
  const client = useQueryClient();
  const enabled = agentId != null && threadId != null;
  const [pages, setPages] = useState<AiChatMessagePage[]>([]);
  const seenRef = useRef<unknown>(null);

  const first = useQuery({
    queryKey: enabled ? qk.chatMessages(threadId) : qk.chatMessages('none'),
    queryFn: () => getAiAgentThreadMessages(scopeKey, agentId!, threadId!, 0),
    enabled,
  });

  // Every arrival of the newest page replaces the whole window: a newly opened thread
  // starts fresh, and the same thread's page 0 arriving again (a version switch changed
  // which branch is shown) means the older pages already loaded belong to a branch that
  // is no longer the one on screen.
  useEffect(() => {
    if (!first.data || first.data === seenRef.current) return;
    seenRef.current = first.data;
    setPages([first.data]);
  }, [first.data]);

  const nextPage = pages.at(-1)?.nextPage ?? null;
  const [loadingOlder, setLoadingOlder] = useState(false);

  const loadOlder = useCallback(async () => {
    if (nextPage == null || !enabled) return;
    setLoadingOlder(true);
    try {
      const page = await client.fetchQuery({
        queryKey: [...qk.chatMessages(threadId!), nextPage],
        queryFn: () => getAiAgentThreadMessages(scopeKey, agentId!, threadId!, nextPage),
      });
      setPages((current) => [...current, page]);
    } finally {
      setLoadingOlder(false);
    }
  }, [client, nextPage, enabled, scopeKey, agentId, threadId]);

  const messages = useMemo<PlanUIMessage[]>(
    () =>
      pages
        .slice()
        .reverse()
        .flatMap((page) => page.items.map(toUIMessage)),
    [pages],
  );

  const activeAnswer = pages[0]?.activeAnswer ?? null;

  return {
    messages,
    activeAnswer,
    hasOlder: nextPage != null,
    loadingOlder,
    loadOlder,
    isLoading: first.isLoading,
    refetch: first.refetch,
  };
}
