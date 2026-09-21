'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { InputGroupButton } from '@/components/ui/input-group';

interface SpeechRecognitionResultEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: { transcript: string };
    };
  };
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export default function AgentChatSpeechInput({
  disabled,
  onTranscript,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const t = useTranslations('common.agentChat');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    const Recognition = recognitionConstructor();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) transcript += result[0]?.transcript ?? '';
      }
      if (transcript.trim()) onTranscriptRef.current(transcript.trim());
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === 'aborted') return;
      toast.error(t('dictationFailed'));
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setSupported(true);

    return () => {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [t]);

  if (!supported) return null;

  function toggle() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }
    try {
      recognition.lang = navigator.language;
      recognition.start();
      setListening(true);
    } catch {
      toast.error(t('dictationFailed'));
    }
  }

  return (
    <InputGroupButton
      type="button"
      variant={listening ? 'default' : 'ghost'}
      size="icon-xs"
      className="rounded-md"
      title={listening ? t('stopDictation') : t('startDictation')}
      aria-pressed={listening}
      disabled={disabled}
      onClick={toggle}
    >
      {listening ? <Square className="fill-current" /> : <Mic />}
      <span className="sr-only">{listening ? t('stopDictation') : t('startDictation')}</span>
    </InputGroupButton>
  );
}
