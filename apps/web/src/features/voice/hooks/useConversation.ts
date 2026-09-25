'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transcribeRecording } from '@/lib/api/endpoints/voice';
import {
  ConversationController,
  type ConversationMessage,
  type ConversationProblem,
} from '../browser/conversationController';
import {
  conversationPhase,
  initialConversation,
  type ConversationPhase,
  type ConversationState,
} from '../utils/conversation';
import type { TurnTimings } from '../utils/turnTimings';
import { useVoice } from './useVoice';

// The chat's conversation mode (hands-free): see browser/conversationController.ts. The chat
// passes its messages (as text), whether an answer is coming, how many messages wait in its
// queue, and how to send; it gets the phase to show, start/stop, and a meter hook.
export interface ConversationOptions {
  messages: ConversationMessage[];
  busy: boolean;
  queued: number;
  send: (text: string) => void;
  onProblem: (problem: ConversationProblem) => void;
}

export interface Conversation {
  // Whether the browser and Helena's answer are known (the button shows from then on).
  ready: boolean;
  phase: ConversationPhase;
  state: ConversationState;
  // What was understood last, for a moment.
  heard: string | null;
  listenerEngine: 'local' | 'browser' | 'none';
  // Where the time of the last answered turn went (null before the first).
  timings: TurnTimings | null;
  // Speech was heard a moment ago but not understood.
  misheard: boolean;
  speakerEngine: 'local' | 'browser' | 'none';
  start: () => void;
  stop: () => void;
  interrupt: () => void;
  dismissNotice: () => void;
  // Registers the meter's painter (called with the input level, 0…1).
  onLevel: (paint: ((level: number) => void) | null) => void;
}

const HEARD_MS = 4_000;

export function useConversation(options: ConversationOptions): Conversation {
  const voice = useVoice();
  const [state, setState] = useState<ConversationState>(initialConversation);
  const [heard, setHeard] = useState<string | null>(null);
  const [timings, setTimings] = useState<TurnTimings | null>(null);
  const [misheard, setMisheard] = useState(false);
  const painter = useRef<((level: number) => void) | null>(null);
  const latest = useRef(options);
  const refresh = useRef(voice.refresh);
  const heardTimer = useRef(0);
  useEffect(() => {
    latest.current = options;
    refresh.current = voice.refresh;
  });

  // Made on first use, in an effect or a click (never during render).
  const made = useRef<ConversationController | null>(null);
  const controller = useCallback((): ConversationController => {
    made.current ??= new ConversationController({
      onState: setState,
      onHeard: (text) => {
        setMisheard(false);
        setHeard(text);
        window.clearTimeout(heardTimer.current);
        heardTimer.current = window.setTimeout(() => setHeard(null), HEARD_MS);
      },
      onLevel: (level) => painter.current?.(level),
      onProblem: (problem) => latest.current.onProblem(problem),
      send: (text) => latest.current.send(text),
      transcribe: (wav, language) => transcribeRecording(wav, language),
      onMisheard: () => {
        setHeard(null);
        setMisheard(true);
        window.clearTimeout(heardTimer.current);
        heardTimer.current = window.setTimeout(() => setMisheard(false), HEARD_MS);
      },
      refreshStatus: () => refresh.current(),
      onTimings: setTimings,
    });
    return made.current;
  }, []);

  useEffect(() => {
    controller().setEngines(voice.listener, voice.speaker);
  }, [controller, voice.listener, voice.speaker]);

  useEffect(() => {
    controller().configure({ pauseMs: voice.pauseMs, speed: voice.speed });
  }, [controller, voice.pauseMs, voice.speed]);

  useEffect(() => {
    controller().update(options.messages, options.busy, options.queued);
  }, [controller, options.messages, options.busy, options.queued]);

  // Leaving the chat ends the conversation: microphone off, voice silent.
  useEffect(
    () => () => {
      made.current?.stop();
      window.clearTimeout(heardTimer.current);
    },
    [controller],
  );

  const start = useCallback(() => {
    controller().start(latest.current.messages, latest.current.busy);
  }, [controller]);

  return useMemo(
    () => ({
      ready: voice.ready,
      phase: conversationPhase(state),
      state,
      heard,
      timings,
      misheard,
      listenerEngine: voice.listener.engine,
      speakerEngine: voice.speaker.engine,
      start,
      stop: () => controller().stop(),
      interrupt: () => controller().interrupt(),
      dismissNotice: () => controller().dismissNotice(),
      onLevel: (paint) => {
        painter.current = paint;
      },
    }),
    [
      voice.ready,
      voice.listener.engine,
      voice.speaker.engine,
      state,
      heard,
      timings,
      misheard,
      start,
      controller,
    ],
  );
}
