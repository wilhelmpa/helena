'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { updateChat, type JevFirstStageMode } from '@/lib/api/endpoints/agentChat';
import { qk } from '@/services/queryKeys';
import { parseJevMode } from '../utils/chatCommands';
import { useChatSummary } from './useChatSummary';

export function useChatJev(threadId: string | null) {
  const t = useTranslations('chatWorkspace');
  const cache = useQueryClient();
  const summary = useChatSummary(threadId);
  const change = useMutation({
    scope: { id: `chat-jev:${threadId}` },
    mutationFn: ({ id, mode }: { id: string; mode: JevFirstStageMode }) =>
      updateChat(id, { jevFirstStage: mode }),
    onSuccess: async (_, { id, mode }) => {
      await cache.invalidateQueries({ queryKey: qk.chat(id) });
      toast.success(t('jev.saved', { mode: t(`jev.${mode}`) }), { description: t('jev.scope') });
    },
  });

  return (query: string) => {
    if (!threadId) return void toast.info(t('jev.needsChat'));
    if (!query.trim()) {
      if (!summary.data) return;
      return void toast.info(t('jev.status', { mode: t(`jev.${summary.data.jevFirstStage}`) }), {
        description: t('jev.scope'),
      });
    }
    const mode = parseJevMode(query);
    if (!mode) return void toast.info(t('jev.usage'));
    change.mutate({ id: threadId, mode });
  };
}
