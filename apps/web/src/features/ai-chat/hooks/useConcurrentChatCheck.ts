'use client';

import { useCallback } from 'react';
import { listChats } from '@/lib/api/endpoints/agentChat';

// Whether sending now would keep the agent's running chats within the member's own
// limit (see useConcurrentChatLimit) — a fresh read at send time rather than a
// subscription, since it only has to be right the moment a message goes out.
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
