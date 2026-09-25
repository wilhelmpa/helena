'use client';

import { useTranslations } from 'next-intl';
import { AudioLines } from 'lucide-react';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import type { Conversation } from '../hooks/useConversation';

// Starts the hands-free conversation (speak, hear the answer, speak again), or ends the one
// running — a toggle, pressed while it runs. Sits in the send button's place while nothing is
// typed. When nothing can listen here (plain http, "Nur lokal" while local AI is down) the click
// says why.
export default function ConversationButton({ conversation }: { conversation: Conversation }) {
  const t = useTranslations('chatWorkspace.voice');
  const active = conversation.phase !== 'off';
  const unavailable = conversation.listenerEngine === 'none';
  return (
    <PromptInputButton
      variant={active ? 'secondary' : 'default'}
      tooltip={active ? t('endConversation') : t('startConversation')}
      aria-pressed={active}
      onClick={active ? conversation.stop : conversation.start}
      className={cn(
        'rounded-lg',
        active
          ? 'bg-accent text-foreground hover:text-foreground'
          : 'text-primary-foreground hover:text-primary-foreground',
        unavailable && !active && 'opacity-60',
      )}
    >
      <AudioLines className={cn('size-4', active && 'animate-pulse')} />
    </PromptInputButton>
  );
}
