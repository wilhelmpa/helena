'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getFollowups,
  sendFollowup,
  followupEvent,
  mergeFollowup,
  type Followup,
  type Followups,
  type FollowupMode,
  type FollowupTarget,
} from '@/lib/api/endpoints/agentFollowups';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';

export function useAgentFollowups(target: FollowupTarget | null) {
  const client = useQueryClient();
  const key = ['agentFollowups', target] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => getFollowups(target!),
    enabled: target !== null,
    // The modes are the agent's: kept while the next answer's list is read.
    placeholderData: keepPreviousData,
  });
  const accept = useCallback(
    (item: Followup) => {
      client.setQueryData<Followups>(['agentFollowups', target], (current) =>
        current
          ? {
              ...current,
              items: mergeFollowup(current.items, item),
            }
          : undefined,
      );
    },
    [client, target],
  );
  const mutation = useMutation({
    mutationFn: (input: { id: string; prompt: string; mode?: FollowupMode }) => {
      if (!target) throw new Error('No active work');
      return sendFollowup(target, {
        ...input,
        mode: input.mode ?? (query.data?.modes.includes('inject') ? 'inject' : 'after'),
      });
    },
    onSuccess: accept,
  });
  const onEvent = useCallback(
    (event: AgUiEvent) => {
      const item = followupEvent(event);
      if (item) accept(item);
    },
    [accept],
  );
  return {
    ...query,
    modes: query.data?.modes ?? [],
    // What the previous answer's list showed while this one's is being read is not this one's.
    items: query.isPlaceholderData ? [] : (query.data?.items ?? []),
    send: mutation.mutateAsync,
    sending: mutation.isPending,
    onEvent,
  };
}
