'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getVoiceStatus } from '@/lib/api/endpoints/voice';
import { clampPause } from '../utils/voiceSettings';
import {
  detectBrowserVoice,
  pickListener,
  pickSpeaker,
  type BrowserVoice,
  type Listener,
  type Speaker,
} from '../utils/voiceEngine';

// Under Lokale KI's key, so switching a class there refreshes it here too.
export const voiceStatusKey = ['localAi', 'voice'] as const;

export function useVoiceStatus() {
  return useQuery({
    queryKey: voiceStatusKey,
    queryFn: getVoiceStatus,
    staleTime: 30_000,
    refetchInterval: 120_000,
    retry: false,
  });
}

const NOTHING: BrowserVoice = {
  secure: true,
  recognition: false,
  recorder: false,
  synthesis: false,
};

// What the browser can do does not change while the page lives: read once, after hydration (the
// server render knows no browser and answers null).
let detected: BrowserVoice | null = null;
const browserSnapshot = () => (detected ??= detectBrowserVoice());
const serverSnapshot = () => null;
const subscribe = () => () => {};

// Who listens and who speaks in this browser now. `ready` is false until both the browser was
// looked at (after mount: the server render cannot know it) and Helena answered where the work
// runs — so "Nur lokal" never falls back to the browser while the answer is still on its way.
export function useVoice(): {
  ready: boolean;
  browser: BrowserVoice;
  listener: Listener;
  speaker: Speaker;
  maxSeconds: number;
  // How long a pause ends a conversation turn, and how fast the voice reads (Sprache settings).
  pauseMs: number;
  speed: number;
  refresh: () => void;
} {
  const status = useVoiceStatus();
  const browser = useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
  const known = status.data ?? null;
  const settled = status.isSuccess || status.isError;
  const { refetch } = status;
  return useMemo(
    () => ({
      ready: browser !== null && settled,
      browser: browser ?? NOTHING,
      listener: pickListener(known, browser ?? NOTHING),
      speaker: pickSpeaker(known, browser ?? NOTHING),
      maxSeconds: known?.limits.maxSeconds ?? 120,
      pauseMs: clampPause(known?.settings?.pauseMs),
      speed: known?.settings?.speed ?? 1,
      refresh: () => void refetch(),
    }),
    [browser, known, settled, refetch],
  );
}
