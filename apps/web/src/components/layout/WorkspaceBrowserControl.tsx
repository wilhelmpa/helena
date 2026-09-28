'use client';

import { Bot, Hand } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRelativeTime } from '@/context/relativeTimeContext';
import type { LiveControlState } from '@/utils/browserLive';
import { Button } from '@/components/ui/button';

// Who controls the project browser (design §5), over the top of the live view: an agent by
// name and since when, with "Übernehmen"; the owner, with "Zurückgeben". Nothing while the
// browser is free. Without the browser gateway there is no lock, only who last acted: an
// agent at work is named, without a button.
export default function WorkspaceBrowserControl({
  control,
  onTakeOver,
  onHandBack,
  busy,
  inline = false,
}: {
  control: LiveControlState;
  onTakeOver: () => void;
  onHandBack: () => void;
  busy: boolean;
  inline?: boolean;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const relativeTime = useRelativeTime();
  if (control.by === 'free') return null;
  if (!control.locked) {
    return control.by === 'agent' ? (
      <div
        className={
          inline
            ? 'flex items-center gap-1.5 text-[11px] text-[#ff912e]'
            : 'pointer-events-none absolute start-2 top-2 flex h-7 items-center gap-1.5 rounded-md bg-background/85 px-2 text-xs text-muted-foreground shadow-sm'
        }
      >
        {inline ? (
          <span className="size-1.5 rounded-full bg-[#ff912e]" />
        ) : (
          <Bot className="size-3.5" />
        )}
        {inline
          ? `${control.agentName ?? t('controlledByAgentGeneric')} steuert`
          : t('controlAgent')}
      </div>
    ) : null;
  }
  const since = control.since ? relativeTime(new Date(control.since).toISOString()) : null;
  return (
    <div
      data-live-dialog
      className={
        inline
          ? 'flex max-w-44 items-center gap-1.5 text-[11px] text-[#ff912e]'
          : 'absolute start-2 top-2 flex h-8 max-w-[calc(100%-1rem)] items-center gap-2 rounded-md bg-background/90 ps-2 pe-1 text-xs text-muted-foreground shadow-sm'
      }
    >
      {control.by === 'agent' ? (
        inline ? (
          <span className="size-1.5 shrink-0 rounded-full bg-[#ff912e]" />
        ) : (
          <Bot className="size-3.5 shrink-0" />
        )
      ) : (
        <Hand className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 truncate">
        {control.by === 'agent' ? (
          inline ? (
            `${control.agentName ?? t('controlledByAgentGeneric')} steuert`
          ) : (
            <>
              {t('controlPrefix')}{' '}
              <strong className="font-medium text-foreground">
                {control.agentName ?? t('controlledByAgentGeneric')}
              </strong>
            </>
          )
        ) : (
          <strong className="font-medium text-foreground">{t('youControl')}</strong>
        )}
        {since && <> · {since}</>}
      </span>
      {control.by === 'agent' ? (
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onClick={onTakeOver}
        >
          {t('takeOver')}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onClick={onHandBack}
        >
          {t('handBack')}
        </Button>
      )}
    </div>
  );
}
