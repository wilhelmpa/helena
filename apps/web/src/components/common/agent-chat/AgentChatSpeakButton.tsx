'use client';

import { useEffect, useRef, useState } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function AgentChatSpeakButton({ text }: { text: string }) {
  const t = useTranslations('common.agentChat');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    return () => {
      if (utteranceRef.current) window.speechSynthesis.cancel();
    };
  }, []);

  if (!supported || !text.trim()) return null;

  function toggle() {
    if (speaking) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
      setSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language;
    const finish = () => {
      utteranceRef.current = null;
      setSpeaking(false);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    utteranceRef.current = utterance;
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="ms-1 size-6 text-muted-foreground"
      title={speaking ? t('stopReading') : t('readAloud')}
      aria-pressed={speaking}
      onClick={toggle}
    >
      {speaking ? <Square className="fill-current" /> : <Volume2 />}
      <span className="sr-only">{speaking ? t('stopReading') : t('readAloud')}</span>
    </Button>
  );
}
