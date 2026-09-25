'use client';

// Adapted from AI Elements `speech-input` (Apache-2.0, see ./LICENSE): dictation into a
// text field, either with the browser's Web Speech API or by recording for a server to
// transcribe.
//
// Changed for Helena: which engine listens is the caller's choice (Helena's local Whisper or
// the browser's recognition, see features/voice); the browser's words appear in the field while
// they are spoken (interim results), after whatever was typed before; a recording shows the
// microphone's level and stops by itself at its limit; the language is the page's; and when
// nothing can listen (plain http, "Nur lokal" while local AI is down, a browser without
// recognition) the button stays and says why instead of silently doing nothing.

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InputGroupButton } from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  recognitionConstructor,
  recognitionLanguage,
  type BrowserRecognition,
} from '@/utils/speechRecognition';

// A recording in progress: `stop` hands back its text.
export interface SpeechRecording {
  stop: () => Promise<string>;
  cancel: () => void;
}

// Records for a server to transcribe. `onLevel` gets the microphone's level (0…1) while it
// records; `onLimit` is called when the recording stopped at its length limit.
export interface SpeechRecorder {
  start: (options: {
    onLevel: (level: number) => void;
    onLimit: () => void;
  }) => Promise<SpeechRecording>;
}

export type SpeechInputEngine = 'recognition' | 'recorder' | 'none';

export type SpeechInputError = 'blocked' | 'failed' | 'nothing-heard' | 'limit';

export type SpeechInputProps = Omit<
  ComponentProps<typeof InputGroupButton>,
  'onChange' | 'value' | 'onError'
> & {
  // The field's text, and how to set it: dictation is appended after it.
  value: string;
  onChange: (text: string) => void;
  maxLength?: number;
  engine: SpeechInputEngine;
  // With engine "recorder".
  recorder?: SpeechRecorder;
  // With engine "none": says why nothing can listen.
  onUnavailable?: () => void;
  onError?: (error: SpeechInputError, cause?: unknown) => void;
  labels: { start: string; stop: string; unavailable: string };
};

function appended(current: string, text: string): string {
  if (!text) return current;
  return current && !/\s$/.test(current) ? `${current} ${text}` : `${current}${text}`;
}

export function SpeechInput({
  value,
  onChange,
  maxLength = Infinity,
  engine,
  recorder,
  onUnavailable,
  onError,
  labels,
  className,
  disabled,
  ...props
}: SpeechInputProps) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const recognition = useRef<BrowserRecognition | null>(null);
  const recording = useRef<SpeechRecording | null>(null);
  const ring = useRef<HTMLSpanElement>(null);
  // The field's text when dictation started, and what has been recognized for good since.
  const base = useRef('');
  const finals = useRef('');
  const latest = useRef({ value, onChange, onError });
  useEffect(() => {
    latest.current = { value, onChange, onError };
  });

  useEffect(
    () => () => {
      recognition.current?.abort();
      recording.current?.cancel();
    },
    [],
  );

  const emit = useCallback(
    (text: string) => latest.current.onChange(text.slice(0, maxLength)),
    [maxLength],
  );

  const startRecognition = useCallback(() => {
    const Recognition = recognitionConstructor();
    if (!Recognition) return;
    const current = latest.current.value;
    base.current = current && !/\s$/.test(current) ? `${current} ` : current;
    finals.current = '';
    const next = new Recognition();
    next.continuous = true;
    next.interimResults = true;
    next.lang = recognitionLanguage();
    next.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]!;
        if (result.isFinal) finals.current += result[0].transcript;
        else interim += result[0].transcript;
      }
      emit(`${base.current}${finals.current}${interim}`);
    };
    next.onerror = (event) => {
      setListening(false);
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      latest.current.onError?.(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'blocked'
          : 'failed',
      );
    };
    next.onend = () => {
      setListening(false);
      emit(`${base.current}${finals.current}`);
    };
    recognition.current = next;
    try {
      next.start();
      setListening(true);
    } catch (error) {
      latest.current.onError?.('failed', error);
    }
  }, [emit]);

  const finishRecording = useCallback(async () => {
    const active = recording.current;
    recording.current = null;
    setListening(false);
    if (ring.current) ring.current.style.transform = 'scale(1)';
    if (!active) return;
    setProcessing(true);
    try {
      const text = await active.stop();
      if (text) emit(appended(latest.current.value, text));
      else latest.current.onError?.('nothing-heard');
    } catch (error) {
      latest.current.onError?.('failed', error);
    } finally {
      setProcessing(false);
    }
  }, [emit]);

  const startRecorder = useCallback(async () => {
    if (!recorder) return;
    try {
      recording.current = await recorder.start({
        onLevel: (level) => {
          if (ring.current) ring.current.style.transform = `scale(${1 + level * 0.6})`;
        },
        onLimit: () => {
          latest.current.onError?.('limit');
          void finishRecording();
        },
      });
      setListening(true);
    } catch (error) {
      const blocked =
        (error instanceof Error && 'reason' in error && error.reason === 'blocked') ||
        (error instanceof DOMException && error.name === 'NotAllowedError');
      latest.current.onError?.(blocked ? 'blocked' : 'failed', error);
    }
  }, [recorder, finishRecording]);

  const toggle = useCallback(() => {
    if (engine === 'none') {
      onUnavailable?.();
      return;
    }
    if (listening) {
      recognition.current?.stop();
      if (recording.current) void finishRecording();
      return;
    }
    if (engine === 'recognition') startRecognition();
    else void startRecorder();
  }, [engine, listening, onUnavailable, startRecognition, startRecorder, finishRecording]);

  const label = engine === 'none' ? labels.unavailable : listening ? labels.stop : labels.start;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <InputGroupButton
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={listening}
          disabled={disabled || processing}
          onClick={toggle}
          className={cn(
            'relative text-muted-foreground hover:text-foreground',
            listening &&
              'bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive',
            engine === 'none' && 'opacity-60',
            className,
          )}
          {...props}
        >
          {listening && engine === 'recorder' ? (
            <span
              ref={ring}
              aria-hidden="true"
              className="absolute inset-1 rounded-full bg-destructive/15 transition-transform duration-75"
            />
          ) : null}
          {processing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : listening ? (
            <Square className="relative size-3.5 animate-pulse fill-current" aria-hidden="true" />
          ) : (
            <Mic className="size-4" aria-hidden="true" />
          )}
        </InputGroupButton>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
