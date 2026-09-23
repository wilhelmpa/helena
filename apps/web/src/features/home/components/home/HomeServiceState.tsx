import { useTranslations } from 'next-intl';
import type { SystemServiceHealth } from '@/lib/api/endpoints/god';
import { formatDurationShort } from '@/utils/dates';
import StatusBadge from '@/components/common/page/StatusBadge';
import { healthStatus } from '../../utils/systemHealth';

// One service of the health overview: its state and when it was last seen working. A
// report, not a control — no frame, no hover, nothing to click. The reason of a failed
// check is the tooltip.
export default function HomeServiceState({ health }: { health: SystemServiceHealth }) {
  const t = useTranslations('god.systemHealth');
  return (
    <li
      className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm"
      title={health.error ?? undefined}
    >
      <StatusBadge status={healthStatus(health.state)} dotOnly />
      <span className="min-w-0 truncate">{t(`service.${health.service}`)}</span>
      <span className="ms-auto shrink-0 text-xs text-muted-foreground">
        {health.lastSeenAt
          ? t(health.state === 'ok' ? 'seen' : 'lastSeen', {
              time: formatDurationShort(health.lastSeenAt),
            })
          : t('neverSeen')}
      </span>
    </li>
  );
}
