'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Square, Volume2 } from 'lucide-react';
import { MessageAction } from '@/components/ai-elements/message';
import { speak, stopSpeaking } from '@/features/voice/browser/speak';
import { useVoice } from '@/features/voice/hooks/useVoice';
import { speechText } from '@/features/voice/utils/speechText';

// Reads an answer aloud with the voice of the conversation mode — Helena's local voice where it
// runs, else the browser's speech synthesis: its words without the Markdown around them, in the
// page's language; stops on a second press or when the message leaves the view.
export default function ChatSpeakButton({ text }: { text: string }) {
  const t = useTranslations('common.agentChat');
  const voice = useVoice();
  const [speaking, setSpeaking] = useState(false);
  const mine = useRef(false);

  useEffect(
    () => () => {
      if (mine.current) stopSpeaking();
    },
    [],
  );

  if (!voice.ready || voice.speaker.engine === 'none' || !speechText(text)) return null;

  function toggle() {
    if (speaking) {
      stopSpeaking();
      mine.current = false;
      setSpeaking(false);
      return;
    }
    mine.current = speak(text, {
      speaker: voice.speaker,
      speed: voice.speed,
      onEnd: () => {
        mine.current = false;
        setSpeaking(false);
      },
    });
    setSpeaking(mine.current);
  }

  return (
    <MessageAction
      label={speaking ? t('stopReading') : t('readAloud')}
      aria-pressed={speaking}
      onClick={toggle}
    >
      {speaking ? <Square className="size-3 fill-current" /> : <Volume2 />}
    </MessageAction>
  );
}
