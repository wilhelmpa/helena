'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth-client';
import { request } from '@/lib/api/core/client';
import type { ChatLocation } from '../utils/chatLocation';

const empty: ChatLocation = { agentId: null, threadId: null };
const writes = new Map<string, Promise<unknown>>();

function cacheKey(userId: string, scope: string) {
  return `volition:active-chat:${userId}:${scope}`;
}

function cachedLocation(key: string): ChatLocation | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as ChatLocation | null;
    return value &&
      (value.threadId == null || typeof value.threadId === 'string') &&
      (value.agentId == null || typeof value.agentId === 'number')
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function cacheLocation(key: string, location: ChatLocation) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(location));
  } catch {
    // The server remains authoritative when browser storage is unavailable.
  }
}

export function useActiveChat(scope: string | null) {
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;
  const qc = useQueryClient();
  const key = userId && scope ? cacheKey(userId, scope) : null;
  const queryKey = useMemo(() => ['volition-active-chat', userId, scope] as const, [userId, scope]);
  const query = useQuery({
    queryKey,
    enabled: key != null,
    queryFn: () =>
      request<ChatLocation>(`/account/active-chat?scope=${encodeURIComponent(scope!)}`),
    placeholderData: key ? () => cachedLocation(key) : undefined,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (key && query.data) cacheLocation(key, query.data);
  }, [key, query.data]);

  const set = useCallback(
    (next: ChatLocation) => {
      if (!key || !scope) return;
      void qc.cancelQueries({ queryKey });
      qc.setQueryData(queryKey, next);
      cacheLocation(key, next);
      const previous = writes.get(key) ?? Promise.resolve();
      const write = previous
        .catch(() => undefined)
        .then(() =>
          request<ChatLocation>(`/account/active-chat?scope=${encodeURIComponent(scope)}`, {
            method: 'PUT',
            body: JSON.stringify(next),
          }),
        );
      writes.set(key, write);
      void write
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : 'Could not remember the chat.');
        })
        .finally(() => {
          if (writes.get(key) === write) writes.delete(key);
        });
    },
    [key, scope, qc, queryKey],
  );

  const validate = useCallback(async (): Promise<ChatLocation> => {
    if (!key || !scope) return empty;
    await writes.get(key)?.catch(() => undefined);
    const before = qc.getQueryData<ChatLocation>(queryKey);
    const fromServer = await request<ChatLocation>(
      `/account/active-chat?scope=${encodeURIComponent(scope)}`,
    );
    // A click made while the read was in flight wins over that read.
    const current = qc.getQueryData<ChatLocation>(queryKey);
    if (current !== before) return current ?? empty;
    qc.setQueryData(queryKey, fromServer);
    cacheLocation(key, fromServer);
    return fromServer;
  }, [key, scope, qc, queryKey]);

  return {
    location: query.data ?? empty,
    // A cached thread may have been deleted elsewhere. Wait for the server's
    // validation before opening it, while still keeping the cache as query data.
    ready: key != null && (query.isFetched || (query.isSuccess && !query.isPlaceholderData)),
    set,
    validate,
  };
}
