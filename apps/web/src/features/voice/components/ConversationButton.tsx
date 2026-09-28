'use client';

import { useTranslations } from 'next-intl';
import { AudioLines, Mic } from 'lucide-react';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import type { Conversation } from '../hooks/useConversation';
import styles from './ConversationButton.module.css';

// Starts the hands-free conversation (speak, hear the answer, speak again), or ends the one
// running — a toggle, pressed while it runs. Sits in the send button's place while nothing is
// typed. When nothing can listen here (plain http, "Nur lokal" while local AI is down) the click
// says why.
export default function ConversationButton({
  conversation,
  homeLanding = false,
}: {
  conversation: Conversation;
  homeLanding?: boolean;
}) {
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
        active
          ? 'bg-accent text-foreground hover:text-foreground'
          : 'text-primary-foreground hover:text-primary-foreground',
        homeLanding ? styles.homeMic : 'rounded-md',
        unavailable && !active && 'opacity-60',
      )}
    >
      {homeLanding ? (
        <Mic className={cn(active && 'animate-pulse')} />
      ) : (
        <AudioLines className={cn('size-4', active && 'animate-pulse')} />
      )}
    </PromptInputButton>
  );
}
