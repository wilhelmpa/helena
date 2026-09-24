'use client';

import { useCallback, useSyncExternalStore } from 'react';

// The current time, ticking every `intervalMs`, for countdowns. Null on the server and in
// the first client render, so both agree; the value only changes once per interval.
export function useNow(intervalMs = 30_000): number | null {
  const subscribe = useCallback(
    (changed: () => void) => {
      const timer = setInterval(changed, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => null,
  );
}
