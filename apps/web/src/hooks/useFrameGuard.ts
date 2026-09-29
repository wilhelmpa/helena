'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FRAME_LOAD_TIMEOUT_MS,
  frameRetryDelay,
  loadedFrameProblem,
  probeFrameUrl,
  sameOrigin,
  type FrameProblemReason,
  type FrameProbeResult,
} from '@/utils/frameProbe';

export type FrameGuardState =
  | { phase: 'probing' }
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'failed'; reason: FrameProblemReason; status?: number; retrying: boolean };

// A frame shown only once its address answers, and replaced by Ava's own view when it
// does not (Auftrag 116): before it loads (probe), while it loads (time limit), after it
// loaded (the browser's own error page), and later — after standby, a network change or
// a restart of the service it asks again and reconnects by itself as soon as it answers.
// `session` changes every time the frame is to load afresh (the frame's key).
export function useFrameGuard({
  url,
  active,
  reloadToken = 0,
  probe = probeFrameUrl,
  loadTimeoutMs = FRAME_LOAD_TIMEOUT_MS,
  retryDelay = frameRetryDelay,
}: {
  url: string;
  // Shown: a hidden frame is not held to the time limit (a lazy frame does not load).
  active: boolean;
  reloadToken?: number;
  probe?: typeof probeFrameUrl;
  loadTimeoutMs?: number;
  retryDelay?: (attempt: number) => number;
}) {
  const [state, setStateValue] = useState<FrameGuardState>({ phase: 'probing' });
  const phase = useRef<FrameGuardState['phase']>('probing');
  const setState = useCallback((next: FrameGuardState) => {
    phase.current = next.phase;
    setStateValue(next);
  }, []);
  const [session, setSession] = useState(0);
  const attempt = useRef(0);
  const blocked = useRef(false);
  const run = useRef(0);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const local = sameOrigin(url, origin);

  const check = useCallback(
    async (quiet: boolean) => {
      const id = ++run.current;
      const result: FrameProbeResult = await probe(url, { origin });
      if (id !== run.current) return;
      if (result.ok) {
        attempt.current = 0;
        // A quiet check of a frame that is showing (or loading) leaves it as it is, and so
        // does one of a page that refused to be shown.
        if (quiet && (phase.current === 'ready' || phase.current === 'loading')) return;
        if (quiet && blocked.current) return;
        setSession((value) => value + 1);
        setState({ phase: 'loading' });
      } else {
        setState({ phase: 'failed', reason: result.reason, status: result.status, retrying: true });
      }
    },
    [origin, probe, setState, url],
  );

  // A new address or "Neu laden" of the host: ask first, then load (what shows stays until
  // the answer).
  useEffect(() => {
    attempt.current = 0;
    const timer = setTimeout(() => void check(false), 0);
    return () => clearTimeout(timer);
  }, [check, reloadToken]);

  // Down: ask again, soon and then less often; back: reload.
  useEffect(() => {
    if (state.phase !== 'failed' || !state.retrying) return;
    const timer = setTimeout(() => {
      attempt.current += 1;
      void check(true);
    }, retryDelay(attempt.current));
    return () => clearTimeout(timer);
  }, [check, retryDelay, state]);

  // Loading: the time limit, only while the frame is shown.
  useEffect(() => {
    if (state.phase !== 'loading' || !active) return;
    const timer = setTimeout(
      () => setState({ phase: 'failed', reason: 'timeout', retrying: true }),
      loadTimeoutMs,
    );
    return () => clearTimeout(timer);
  }, [active, loadTimeoutMs, setState, state.phase, session]);

  // Back from standby, on another network, or online again: ask right away.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== 'visible') return;
      attempt.current = 0;
      void check(true);
    };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [check]);

  const onLoad = useCallback(
    (frame: HTMLIFrameElement | null) => {
      const result = loadedFrameProblem(frame, local);
      blocked.current = !result.ok;
      if (result.ok) setState({ phase: 'ready' });
      // The address answers, but its page refuses to be shown here: trying again by itself
      // would only load it again and again. "Neu laden", or coming back, asks once more.
      else setState({ phase: 'failed', reason: result.reason, retrying: false });
    },
    [local, setState],
  );

  const retry = useCallback(() => {
    attempt.current = 0;
    blocked.current = false;
    setState({ phase: 'probing' });
    void check(false);
  }, [check, setState]);

  return {
    state,
    session,
    // The frame is in the page from the first answer on (loading or shown).
    showFrame: state.phase === 'loading' || state.phase === 'ready',
    onLoad,
    retry,
  };
}
