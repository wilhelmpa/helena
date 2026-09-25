'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { canSpeak, stopSpeaking } from '@/features/voice/browser/speak';

// The composer's "read answers aloud" switch: when on, every complete answer is read aloud (see
// ChatThreadView). Turning it off also stops what is being read. The hands-free conversation is
// the button in the send button's place (features/voice).
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
      <Volume2 className="size-4" aria-hidden="true" />
    </PromptInputButton>
  );
}
