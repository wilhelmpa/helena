'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'helena:chat:readAll:';

function stored(threadId: string | null): boolean {
  if (!threadId) return false;
  try {
    return window.localStorage.getItem(KEY + threadId) === '1';
  } catch {
    return false;
  }
}

function store(threadId: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY + threadId, '1');
    else window.localStorage.removeItem(KEY + threadId);
  } catch {
    // storage unavailable: the choice lasts for this page
  }
}

// "Read everything" of one chat: every complete answer of it is read aloud, also to a typed
// question. Off unless the member turned it on for this chat (a chat of its own, not a setting
// of the browser: after a spoken question the typed ones stay quiet). A new chat that gets its
// thread id from its first answer keeps the choice it was given before. Storage may be
// unavailable (a private window), in which case the choice lasts for the page.
export function useReadAll(threadId: string | null): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  const carried = useRef(false);
  useEffect(() => {
    if (carried.current && threadId) {
      carried.current = false;
      store(threadId, true);
      return;
    }
    setOn(stored(threadId));
  }, [threadId]);
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      if (threadId) store(threadId, next);
      else carried.current = next;
    },
    [threadId],
  );
  return [on, set];
}
