'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { speechText } from '../../utils/speechText';

// The voice that fits the page's language best: an exact match ("de-DE"), then any voice
// of the language, then the browser's default.
function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const short = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(short))
  );
}

// Reads an answer aloud (owner, 2026-09-24: "voice"): its words without the Markdown
// around them (speechText), in the page's language, and stops on a second press or
// when the message leaves the view. Works on plain http, unlike dictation.
export default function ChatSpeakButton({ text }: { text: string }) {
  const t = useTranslations('common.agentChat');
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSupported('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    return () => {
      if (utterance.current) window.speechSynthesis.cancel();
    };
  }, []);

  const spoken = speechText(text);
  if (!supported || !spoken) return null;

  function toggle() {
    window.speechSynthesis.cancel();
    if (speaking) {
      utterance.current = null;
      setSpeaking(false);
      return;
    }
    const lang = document.documentElement.lang || navigator.language || 'de-DE';
    const next = new SpeechSynthesisUtterance(spoken);
    next.lang = lang;
    const voice = pickVoice(lang);
    if (voice) next.voice = voice;
    const finish = () => {
      if (utterance.current === next) utterance.current = null;
      setSpeaking(false);
    };
    next.onend = finish;
    next.onerror = finish;
    utterance.current = next;
    setSpeaking(true);
    window.speechSynthesis.speak(next);
  }

  const label = speaking ? t('stopReading') : t('readAloud');
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      onClick={toggle}
      aria-label={label}
      aria-pressed={speaking}
      title={label}
    >
      {speaking ? <Square className="size-3 fill-current" /> : <Volume2 className="size-3.5" />}
    </Button>
  );
}
