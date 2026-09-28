'use client';

import { useTranslations } from 'next-intl';
import { Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Conversation } from '../hooks/useConversation';

// Voice controls and the latest recognized text; the Orb displays the phase.
export default function ConversationBar({ conversation }: { conversation: Conversation }) {
  const t = useTranslations('chatWorkspace.voice');
  const { phase, heard, misheard, timings } = conversation;
  if (phase === 'off') return null;

  return (
    <div
      className="flex min-h-7 items-center gap-2 px-1 text-xs"
      data-voice-timings={timings ? JSON.stringify(timings) : undefined}
    >
      {misheard && phase !== 'hearing' ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{t('misheard')}</span>
      ) : heard && phase !== 'hearing' ? (
        <span dir="auto" className="min-w-0 flex-1 truncate text-muted-foreground">
          {t('heard', { text: heard })}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {phase === 'speaking' && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t('interrupt')}
          className="h-6 shrink-0 gap-1 px-1.5 text-xs font-normal text-foreground"
          onClick={conversation.interrupt}
        >
          <Square className="size-3 fill-current" aria-hidden="true" />
          <span className="hidden @sm/composer:inline">{t('interrupt')}</span>
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={t('end')}
        className="h-6 shrink-0 gap-1 px-1.5 text-xs font-normal text-foreground"
        onClick={conversation.stop}
      >
        <X className="size-3.5" aria-hidden="true" />
        <span className="hidden @sm/composer:inline">{t('end')}</span>
      </Button>
    </div>
  );
}
