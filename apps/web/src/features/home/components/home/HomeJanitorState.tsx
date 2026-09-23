import { useTranslations } from 'next-intl';
import type { JanitorHealth } from '@/lib/api/endpoints/god';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/utils/dates';
import { janitorSummary } from '../../utils/systemHealth';

// One janitor loop of the health overview: whether it is still running on schedule,
// when it last ran, and what it cleaned up that run. The reason of a failed run is the
// tooltip, the same way a service's is.
export default function HomeJanitorState({ health }: { health: JanitorHealth }) {
  const t = useTranslations('god.systemHealth');
  const summary = janitorSummary(health);
  return (
    <li
      className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
      title={health.error ?? undefined}
    >
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          health.state === 'ok' && 'bg-emerald-500',
          health.state === 'down' && 'bg-destructive',
          health.state === 'unknown' && 'bg-muted-foreground/40',
        )}
      />
      <span className="font-medium">{t(`janitor.${health.job}`)}</span>
      <span className="ms-auto text-end text-xs text-muted-foreground">
        {summary ? (
          <>
            {t('janitorRan', { time: formatDurationShort(summary.ranAt) })}
            {summary.cleaned !== null && (
              <>
                {' · '}
                {t('janitorCleaned', { count: summary.cleaned })}
              </>
            )}
          </>
        ) : (
          t('janitorNeverRan')
        )}
      </span>
    </li>
  );
}
