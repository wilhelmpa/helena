'use client';

import { useTranslations } from 'next-intl';
import { Volume1, Volume2 } from 'lucide-react';
import { Text } from '@/design-system';
import { cn } from '@/lib/utils';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { stopSpeaking } from '@/features/voice/browser/speak';
import { useVoice } from '@/features/voice/hooks/useVoice';

// The composer's "read everything" switch of this chat. Off: only the answers to questions that
// were spoken are read aloud (a typed question stays quiet); on: every complete answer of this
// chat is, and the button says "Alles" beside its icon, so the state is never a guess. Turning it
// off also stops what is being read. The hands-free conversation is the button in the send
// button's place (features/voice).
export default function ChatAutoSpeakToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations('chatWorkspace.composer');
  const voice = useVoice();
  if (!voice.ready || voice.speaker.engine === 'none') return null;
  // The state at a glance: off is the quiet speaker (spoken questions only), on is the loud one
  // with "Alles" beside it.
  return (
    <PromptInputButton
      tooltip={on ? t('readAllOn') : t('readAllOff')}
      aria-pressed={on}
      size={on ? 'sm' : 'icon-sm'}
      onClick={() => {
        if (on) stopSpeaking();
        onChange(!on);
      }}
      className={cn(on && 'bg-accent text-foreground')}
    >
      {on ? (
        <Volume2 className="size-4" aria-hidden="true" />
      ) : (
        <Volume1 className="size-4" aria-hidden="true" />
      )}
      {on && <Text size="xs">{t('readAllShort')}</Text>}
    </PromptInputButton>
  );
}
