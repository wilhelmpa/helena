'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AudioLines } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t('autoSpeak')}
          aria-pressed={on}
          onClick={() => {
            if (on) stopSpeaking();
            onChange(!on);
          }}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            on && 'bg-accent text-foreground',
          )}
        >
          <AudioLines className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{on ? t('autoSpeakOn') : t('autoSpeak')}</TooltipContent>
    </Tooltip>
  );
}
