'use client';

import { useCallback } from 'react';
import { listChats } from '@/lib/api/endpoints/agentChat';

// Whether sending now would keep the agent's running chats within its configured
// limit (ai_agent.max_concurrent_chats, set by the owner in Helena) — a fresh read at
// send time rather than a subscription, since it only has to be right the moment a
// message goes out. The server enforces the same limit itself on the actual send, so
// this is a pre-flight check for a clear message, not the source of truth.
export function useConcurrentChatCheck(agentId: number, currentThreadId: string | null) {
  return useCallback(
    async (limit: number) => {
      const page = await listChats({ page: 1, pageSize: limit + 5 }, { agentId, view: 'active' });
      const running = page.items.filter(
        (chat) => chat.running && chat.id !== currentThreadId,
      ).length;
      return running < limit;
    },
    [agentId, currentThreadId],
  );
}
