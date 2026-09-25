'use client';

import { useTranslations } from 'next-intl';
import { AudioLines, X } from 'lucide-react';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import type { Conversation } from '../hooks/useConversation';

// Starts the hands-free conversation (speak, hear the answer, speak again), or ends the one
// running. Sits in the send button's place while nothing is typed. When nothing can listen here
// (plain http, "Nur lokal" while local AI is down) the click says why.
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
        !active && 'text-primary-foreground hover:text-primary-foreground',
        active && 'text-foreground',
        unavailable && !active && 'opacity-60',
      )}
    >
      {active ? <X className="size-4" /> : <AudioLines className="size-4" />}
    </PromptInputButton>
  );
}
