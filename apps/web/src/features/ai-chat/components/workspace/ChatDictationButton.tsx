'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mic, Square } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CHAT_PROMPT_LIMIT } from '../../utils/chatMessages';

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
  const speech = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
}

// The page's language for recognition ("de" → "de-DE"), else the browser's.
function recognitionLanguage(): string {
  const page = document.documentElement.lang;
  if (page && page.includes('-')) return page;
  if (page === 'de') return 'de-DE';
  if (page === 'en') return 'en-US';
  return navigator.language || 'de-DE';
}

// Dictating into the composer (owner, 2026-09-24: "voice"): the browser's speech
// recognition, running until the mic is pressed again, with the words appearing in the
// field while they are spoken — the typed text stays, the dictation is added after it.
// Chrome only lends the microphone to a secure page: on plain http (the LAN until
// Cloudflare is in front) the button stays and says how to allow it instead of silently
// doing nothing; the kiosk browser treats this origin as secure already.
export default function ChatDictationButton({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('chatWorkspace.composer');
  const [supported, setSupported] = useState(false);
  const [secure, setSecure] = useState(true);
  const [listening, setListening] = useState(false);
  const recognition = useRef<BrowserRecognition | null>(null);
  // The field's text when dictation started, and what has been recognized for good since.
  const base = useRef('');
  const finals = useRef('');
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    setSupported(recognitionConstructor() != null);
    setSecure(window.isSecureContext);
    return () => recognition.current?.abort();
  }, []);

  if (!supported) return null;

  const label = listening ? t('stopDictation') : t('dictate');

  function start() {
    if (!secure) {
      toast.info(t('dictationInsecureTitle'), {
        description: t('dictationInsecure', { origin: window.location.origin }),
        duration: 12000,
      });
      return;
    }
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
      const text = `${base.current}${finals.current}${interim}`.slice(0, CHAT_PROMPT_LIMIT);
      latest.current.onChange(text);
    };
    next.onerror = (event) => {
      setListening(false);
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      toast.error(event.error === 'not-allowed' ? t('dictationBlocked') : t('dictationFailed'));
    };
    next.onend = () => {
      setListening(false);
      latest.current.onChange(`${base.current}${finals.current}`.slice(0, CHAT_PROMPT_LIMIT));
    };
    recognition.current = next;
    try {
      next.start();
      setListening(true);
    } catch {
      toast.error(t('dictationFailed'));
    }
  }

  function stop() {
    recognition.current?.stop();
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={listening}
          disabled={disabled}
          onClick={listening ? stop : start}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
            listening &&
              'bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive',
            !secure && 'opacity-60',
          )}
        >
          {listening ? (
            <Square className="size-3.5 animate-pulse fill-current" aria-hidden="true" />
          ) : (
            <Mic className="size-4" aria-hidden="true" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{secure ? label : t('dictationInsecureTitle')}</TooltipContent>
    </Tooltip>
  );
}
