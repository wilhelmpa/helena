'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'helena:chat:autoSpeak';

// Whether answers are read aloud as soon as they are complete — the chat's voice mode,
// together with dictation. A per-browser preference; storage may be unavailable (a
// private window), in which case it simply starts off.
export function useAutoSpeak(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(window.localStorage.getItem(KEY) === '1');
    } catch {
      // storage unavailable: stays off
    }
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      // storage unavailable: the choice lasts for this page
    }
  }, []);
  return [on, set];
}
