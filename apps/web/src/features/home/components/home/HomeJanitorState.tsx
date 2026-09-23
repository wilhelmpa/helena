import { useTranslations } from 'next-intl';
import type { JanitorHealth } from '@/lib/api/endpoints/god';
import { formatDurationShort } from '@/utils/dates';
import StatusBadge from '@/components/common/page/StatusBadge';
import { healthStatus, janitorSummary } from '../../utils/systemHealth';

// One janitor loop of the health overview: whether it is still running on schedule,
// when it last ran, and what it cleaned up that run. A report, like a service's state:
// no frame, no hover. The reason of a failed run is the tooltip.
export default function HomeJanitorState({ health }: { health: JanitorHealth }) {
  const t = useTranslations('god.systemHealth');
  const summary = janitorSummary(health);
  return (
    <li
      className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm"
      title={health.error ?? undefined}
    >
      <StatusBadge status={healthStatus(health.state)} dotOnly />
      <span className="min-w-0 truncate">{t(`janitor.${health.job}`)}</span>
      <span className="ms-auto shrink-0 text-end text-xs text-muted-foreground">
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
