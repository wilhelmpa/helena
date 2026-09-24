'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAiAgentThreadMessages, type AiChatMessagePage } from '@/lib/api/endpoints/agentChat';
import { qk } from '@/services/queryKeys';

// The stored transcript of one thread, for the view that opens it. `initial` is the
// newest page (page 0) as it is right now: read fresh every time a thread is opened —
// never from a cache filled the last time it was open, which would show the thread
// without the turns written since and resume an answer that already ended — and read
// once, since from then on the open view's own chat state is the transcript.
// `fetchPageOf` reads any page on demand: an older one as the reader scrolls up, or
// page 0 again when the view wants the server's version of what it shows (a finished
// answer's model and token counts, the branch a version switch moved to).
export function useChatThread(scopeKey: string, agentId: number, threadId: string | null) {
  const initial = useQuery({
    queryKey: qk.chatMessages(threadId ?? 'none', agentId),
    queryFn: () => getAiAgentThreadMessages(scopeKey, agentId, threadId!, 0),
    enabled: threadId != null,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Any page of this agent's thread — named explicitly, since a new chat's thread only
  // exists once its first answer was queued, long after this hook first ran.
  const fetchPageOf = useCallback(
    (id: string, page: number): Promise<AiChatMessagePage> =>
      getAiAgentThreadMessages(scopeKey, agentId, id, page),
    [scopeKey, agentId],
  );

  return {
    initial: initial.data ?? null,
    isLoading: threadId != null && initial.isPending,
    isError: initial.isError,
    retry: initial.refetch,
    fetchPageOf,
  };
}
