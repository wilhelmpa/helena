'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { canSpeak, speak, stopSpeaking } from '../../utils/speak';
import { speechText } from '../../utils/speechText';

// Reads an answer aloud (owner, 2026-09-24: "voice"): its words without the Markdown
// around them, in the page's language, and stops on a second press or when the message
// leaves the view. Works on plain http, unlike dictation.
export default function ChatSpeakButton({ text }: { text: string }) {
  const t = useTranslations('common.agentChat');
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const mine = useRef(false);

  useEffect(() => {
    setSupported(canSpeak());
    return () => {
      if (mine.current) stopSpeaking();
    };
  }, []);

  if (!supported || !speechText(text)) return null;

  function toggle() {
    if (speaking) {
      stopSpeaking();
      mine.current = false;
      setSpeaking(false);
      return;
    }
    mine.current = speak(text, () => {
      mine.current = false;
      setSpeaking(false);
    });
    setSpeaking(mine.current);
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
