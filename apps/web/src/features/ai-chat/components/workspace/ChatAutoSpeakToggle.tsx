'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { canSpeak, stopSpeaking } from '../../utils/speak';

// The composer's voice-mode switch: when on, every complete answer is read aloud (see
// ChatThreadView). Turning it off also stops what is being read.
export default function ChatAutoSpeakToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations('chatWorkspace.composer');
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(canSpeak()), []);
  if (!supported) return null;
  return (
    <PromptInputButton
      tooltip={on ? t('autoSpeakOn') : t('autoSpeak')}
      aria-pressed={on}
      onClick={() => {
        if (on) stopSpeaking();
        onChange(!on);
      }}
      className={cn(on && 'bg-accent text-foreground')}
    >
      <AudioLines className="size-4" aria-hidden="true" />
    </PromptInputButton>
  );
}
