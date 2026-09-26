'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Conversation } from '../hooks/useConversation';

// The conversation mode's line over the composer: what it is doing (listening, hearing the
// owner, writing down, waiting for the answer, reading it), what was understood last, and the
// two ways out — interrupt the reading, end the conversation. The dot breathes with the
// microphone's level; its tooltip says where the voice goes (this machine or the browser's
// vendor). A `status` region, so a screen reader follows along.
export default function ConversationBar({
  conversation,
  agentName,
}: {
  conversation: Conversation;
  agentName: string;
}) {
  const t = useTranslations('chatWorkspace.voice');
  const dot = useRef<HTMLSpanElement>(null);
  const { phase, heard, misheard, timings, state, onLevel } = conversation;
  const seconds = (ms: number) => (ms / 1000).toFixed(1);

  useEffect(() => {
    onLevel((level) => {
      if (dot.current) dot.current.style.transform = `scale(${0.55 + level * 0.9})`;
    });
    return () => onLevel(null);
  }, [onLevel]);

  if (phase === 'off') return null;

  const label = {
    starting: t('phase.starting'),
    listening: t('phase.listening'),
    hearing: t('phase.hearing'),
    transcribing: t('phase.transcribing'),
    thinking: t('phase.thinking', { agent: agentName }),
    speaking: state.bargeIn
      ? t('phase.speaking', { agent: agentName })
      : t('phase.speakingTap', { agent: agentName }),
  }[phase];

  const where = [
    conversation.listenerEngine === 'local' ? t('where.listenLocal') : t('where.listenBrowser'),
    conversation.speakerEngine === 'local'
      ? t('where.speakLocal')
      : conversation.speakerEngine === 'browser'
        ? t('where.speakBrowser')
        : t('where.speakNone'),
  ].join(' · ');
  // Where the time of the last turn went, for the owner (the dot's tooltip) and the voice E2E.
  const timing = timings
    ? t('timings', {
        total: seconds(timings.totalMs),
        pause: seconds(timings.pauseMs),
        transcribe: seconds(timings.transcribeMs),
        answer: seconds(timings.answerMs),
        voice: seconds(timings.voiceMs),
      })
    : null;

  const live = phase === 'listening' || phase === 'hearing';

  return (
    <Marker
      role="status"
      className="min-h-7 gap-x-2 px-1 text-xs"
      data-voice-timings={timings ? JSON.stringify(timings) : undefined}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            className="relative grid size-5 shrink-0 place-items-center"
            aria-label={where}
          >
            {phase === 'starting' || phase === 'transcribing' ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : (
              <>
                <span
                  className={cn(
                    'absolute inset-0 rounded-full',
                    live ? 'bg-primary/15' : 'bg-muted',
                    phase === 'hearing' && 'animate-pulse',
                  )}
                />
                <span
                  ref={dot}
                  className={cn(
                    'size-2.5 rounded-full transition-transform duration-75',
                    live ? 'bg-primary' : 'bg-muted-foreground',
                    phase === 'speaking' && 'animate-pulse',
                  )}
                />
              </>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {where}
          {timing && <span className="block">{timing}</span>}
        </TooltipContent>
      </Tooltip>
      <MarkerContent
        className={cn(
          'flex min-w-0 flex-1 items-baseline gap-2',
          phase === 'thinking' && 'shimmer',
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        {/* What was understood, where the composer is wide enough (the text is also the
            message in the transcript). */}
        {misheard && phase !== 'hearing' ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{t('misheard')}</span>
        ) : heard && phase !== 'hearing' ? (
          <span
            dir="auto"
            className="hidden min-w-0 flex-1 truncate text-muted-foreground @md/composer:inline"
          >
            {t('heard', { text: heard })}
          </span>
        ) : null}
      </MarkerContent>
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
    </Marker>
  );
}
