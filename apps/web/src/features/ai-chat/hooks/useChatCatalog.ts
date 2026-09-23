'use client';

import { useQuery } from '@tanstack/react-query';
import { getAiAgentChatCatalog } from '@/lib/api/endpoints/agentChat';

// The models and thinking levels the agent's runner last published, for the composer's
// model picker. Empty for a runner that has not reported a catalog yet — the picker
// then offers only "Agent default".
export function useChatCatalog(scopeKey: string, agentId: number) {
  return useQuery({
    queryKey: ['chatWorkspace', 'catalog', scopeKey, agentId],
    queryFn: () => getAiAgentChatCatalog(scopeKey, agentId),
  });
}
