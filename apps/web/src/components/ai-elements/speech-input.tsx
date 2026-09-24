'use client';

// Adapted from AI Elements `speech-input` (Apache-2.0, see ./LICENSE): dictation into a
// text field with the browser's Web Speech API, and, where a browser has none (Firefox),
// a recording handed to `onAudioRecorded` for a server to transcribe.
//
// Changed for Helena: the words appear in the field while they are spoken (interim
// results), after whatever was typed before; the language is the page's; and a page on
// plain http — where no browser lends the microphone — gets `onError('insecure')`
// instead of a button that silently does nothing.

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InputGroupButton } from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}

interface BrowserRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onresult:
    ((event: Event & { resultIndex: number; results: RecognitionResultList }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionConstructor = new () => BrowserRecognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const speech = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
}

// The page's language for recognition ("de" → "de-DE"), else the browser's.
export function recognitionLanguage(): string {
  const page = document.documentElement.lang;
  if (page && page.includes('-')) return page;
  if (page === 'de') return 'de-DE';
  if (page === 'en') return 'en-US';
  return navigator.language || 'de-DE';
}

type Mode = 'speech-recognition' | 'media-recorder' | 'none';

function detectMode(canTranscribe: boolean): Mode {
  if (recognitionConstructor()) return 'speech-recognition';
  if (
    canTranscribe &&
    typeof window !== 'undefined' &&
    'MediaRecorder' in window &&
    'mediaDevices' in navigator
  ) {
    return 'media-recorder';
  }
  return 'none';
}

export type SpeechInputError = 'insecure' | 'blocked' | 'failed';

export type SpeechInputProps = Omit<
  ComponentProps<typeof InputGroupButton>,
  'onChange' | 'value' | 'onError'
> & {
  // The field's text, and how to set it: dictation is appended after it.
  value: string;
  onChange: (text: string) => void;
  maxLength?: number;
  // Transcribes a recording where the browser cannot recognize speech itself.
  onAudioRecorded?: (audio: Blob) => Promise<string>;
  onError?: (error: SpeechInputError) => void;
  labels: { start: string; stop: string; insecure: string };
};

export function SpeechInput({
  value,
  onChange,
  maxLength = Infinity,
  onAudioRecorded,
  onError,
  labels,
  className,
  disabled,
  ...props
}: SpeechInputProps) {
  const [mode, setMode] = useState<Mode>('none');
  const [secure, setSecure] = useState(true);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const recognition = useRef<BrowserRecognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  // The field's text when dictation started, and what has been recognized for good since.
  const base = useRef('');
  const finals = useRef('');
  const latest = useRef({ value, onChange, onAudioRecorded, onError });
  latest.current = { value, onChange, onAudioRecorded, onError };

  // Decided after mount: the server render cannot know the browser.
  useEffect(() => {
    setMode(detectMode(onAudioRecorded != null));
    setSecure(window.isSecureContext);
  }, [onAudioRecorded]);

  useEffect(
    () => () => {
      recognition.current?.abort();
      if (recorder.current?.state === 'recording') recorder.current.stop();
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
      latest.current.onError?.(event.error === 'not-allowed' ? 'blocked' : 'failed');
    };
    next.onend = () => {
      setListening(false);
      emit(`${base.current}${finals.current}`);
    };
    recognition.current = next;
    try {
      next.start();
      setListening(true);
    } catch {
      latest.current.onError?.('failed');
    }
  }, [emit]);

  const startRecorder = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      next.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      next.addEventListener('stop', async () => {
        for (const track of stream.getTracks()) track.stop();
        setListening(false);
        const audio = new Blob(chunks, { type: next.mimeType || 'audio/webm' });
        const transcribe = latest.current.onAudioRecorded;
        if (audio.size === 0 || !transcribe) return;
        setProcessing(true);
        try {
          const text = await transcribe(audio);
          const current = latest.current.value;
          if (text)
            emit(current && !/\s$/.test(current) ? `${current} ${text}` : `${current}${text}`);
        } catch {
          latest.current.onError?.('failed');
        } finally {
          setProcessing(false);
        }
      });
      recorder.current = next;
      next.start();
      setListening(true);
    } catch (error) {
      latest.current.onError?.(
        error instanceof DOMException && error.name === 'NotAllowedError' ? 'blocked' : 'failed',
      );
    }
  }, [emit]);

  const toggle = useCallback(() => {
    if (!secure) {
      latest.current.onError?.('insecure');
      return;
    }
    if (listening) {
      recognition.current?.stop();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      return;
    }
    if (mode === 'speech-recognition') startRecognition();
    else if (mode === 'media-recorder') void startRecorder();
  }, [secure, listening, mode, startRecognition, startRecorder]);

  if (mode === 'none') return null;

  const label = listening ? labels.stop : labels.start;
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
            'text-muted-foreground hover:text-foreground',
            listening &&
              'bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive',
            !secure && 'opacity-60',
            className,
          )}
          {...props}
        >
          {processing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : listening ? (
            <Square className="size-3.5 animate-pulse fill-current" aria-hidden="true" />
          ) : (
            <Mic className="size-4" aria-hidden="true" />
          )}
        </InputGroupButton>
      </TooltipTrigger>
      <TooltipContent side="top">{secure ? label : labels.insecure}</TooltipContent>
    </Tooltip>
  );
}
