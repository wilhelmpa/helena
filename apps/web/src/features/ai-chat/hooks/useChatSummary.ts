'use client';

import { useQuery } from '@tanstack/react-query';
import { getChat } from '@/lib/api/endpoints/agentChat';
import { qk } from '@/services/queryKeys';

// The chat's own record — title, pin, project, archive/trash state — read separately
// from its messages so renaming or pinning does not have to touch the transcript
// query, and the header can show the title before the transcript has loaded.
export function useChatSummary(threadId: string | null) {
  return useQuery({
    queryKey: qk.chat(threadId ?? 'none'),
    queryFn: () => getChat(threadId!),
    enabled: threadId != null,
  });
}
