'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  SpeechInputEngine,
  SpeechInputError,
  SpeechRecorder,
} from '@/components/ai-elements/speech-input';
import { ApiError } from '@/lib/api/core/client';
import { transcribeRecording } from '@/lib/api/endpoints/voice';
import { startRecording } from '../browser/recorder';
import { durationMs, encodeWav16, isSilent } from '../utils/wav';
import { useVoice } from './useVoice';
import { useVoiceProblem } from './useVoiceProblem';
import { dictationProblem } from '../utils/dictationProblem';

// Dictation in the composer (the microphone button): Helena's local Whisper while Lokale KI →
// Transkription takes it (record, then transcribe on this machine), else the browser's own
// recognition, else a button that explains why not (see utils/voiceEngine).

function pageLanguage(): string | null {
  const lang = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(lang) ? lang : null;
}

export function useDictation(): {
  ready: boolean;
  engine: SpeechInputEngine;
  local: boolean;
  recorder: SpeechRecorder;
  onUnavailable: () => void;
  onError: (error: SpeechInputError, cause?: unknown) => void;
  errorText: string | null;
  clearError: () => void;
} {
  const voice = useVoice();
  const problem = useVoiceProblem();
  const t = useTranslations('chatWorkspace.voice.problems');
  const [errorText, setErrorText] = useState<string | null>(null);
  const { listener, maxSeconds, refresh } = voice;

  const recorder = useMemo<SpeechRecorder>(
    () => ({
      async start({ onLevel, onLimit }) {
        const recording = await startRecording({ maxSeconds, onLevel, onLimit });
        return {
          async stop() {
            const samples = await recording.stop();
            // Nothing in it: Whisper would only invent words.
            if (durationMs(samples) < 300 || isSilent(samples)) return '';
            const wav = new Blob([encodeWav16(samples) as BlobPart], { type: 'audio/wav' });
            try {
              const result = await transcribeRecording(wav, pageLanguage());
              setErrorText(null);
              return result.text;
            } catch (error) {
              if (error instanceof ApiError && error.code?.startsWith('voice-local')) refresh();
              throw error;
            }
          },
          cancel: () => recording.cancel(),
        };
      },
    }),
    [maxSeconds, refresh],
  );

  const onUnavailable = useCallback(() => {
    if (listener.engine === 'none') {
      problem(listener.blocker);
      setErrorText(
        t(
          listener.blocker === 'insecure'
            ? 'insecureTitle'
            : listener.blocker === 'local-only-down'
              ? 'localOnlyDownTitle'
              : 'unsupportedTitle',
        ),
      );
    }
  }, [listener, problem, t]);

  const onError = useCallback(
    (error: SpeechInputError, cause?: unknown) => {
      const reason = dictationProblem(error, cause);
      problem(reason, { seconds: maxSeconds });
      const key = (
        {
          limit: 'limit',
          'nothing-heard': 'nothingHeard',
          blocked: 'blocked',
          missing: 'missing',
          failed: 'failed',
          'transcribe-failed': 'transcribeFailed',
          'recognition-failed': 'recognitionFailed',
        } as const
      )[reason];
      setErrorText(t(key, { seconds: maxSeconds }));
    },
    [maxSeconds, problem, t],
  );

  return {
    ready: voice.ready,
    engine:
      listener.engine === 'local'
        ? 'recorder'
        : listener.engine === 'browser'
          ? 'recognition'
          : 'none',
    local: listener.engine === 'local',
    recorder,
    onUnavailable,
    onError,
    errorText,
    clearError: () => setErrorText(null),
  };
}
