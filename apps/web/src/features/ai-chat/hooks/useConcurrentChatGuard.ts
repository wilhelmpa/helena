'use client';

import { useCallback, useSyncExternalStore } from 'react';

// How many chats of the same agent the member may leave answering at once before the
// composer warns instead of sending a fourth. A per-viewer convenience (like a
// remembered tab), not account state, so it lives in localStorage and defaults to the
// owner's "up to 3" when nothing was chosen yet or storage is unavailable.
export const DEFAULT_CONCURRENT_CHAT_LIMIT = 3;
export const MAX_CONCURRENT_CHAT_LIMIT = 10;

function storageKey(agentId: number): string {
  return `chatWorkspace.concurrentLimit.${agentId}`;
}

function readLimit(agentId: number): number {
  if (typeof window === 'undefined') return DEFAULT_CONCURRENT_CHAT_LIMIT;
  try {
    const raw = window.localStorage.getItem(storageKey(agentId));
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value >= 1 && value <= MAX_CONCURRENT_CHAT_LIMIT
      ? value
      : DEFAULT_CONCURRENT_CHAT_LIMIT;
  } catch {
    return DEFAULT_CONCURRENT_CHAT_LIMIT;
  }
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

// The limit for one agent, and a setter the model picker's settings menu offers. The
// value is per browser, so two members configure it independently.
export function useConcurrentChatLimit(agentId: number) {
  const limit = useSyncExternalStore(
    subscribe,
    () => readLimit(agentId),
    () => DEFAULT_CONCURRENT_CHAT_LIMIT,
  );
  const setLimit = useCallback(
    (value: number) => {
      const clamped = Math.min(MAX_CONCURRENT_CHAT_LIMIT, Math.max(1, Math.round(value)));
      try {
        window.localStorage.setItem(storageKey(agentId), String(clamped));
      } catch {
        // Private browsing or a blocked store: the choice just does not persist.
      }
      for (const listener of listeners) listener();
    },
    [agentId],
  );
  return [limit, setLimit] as const;
}
