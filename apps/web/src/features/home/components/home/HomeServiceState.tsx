import { useTranslations } from 'next-intl';
import type { SystemServiceHealth } from '@/lib/api/endpoints/god';
import { cn } from '@/lib/utils';
import { formatDurationShort } from '@/utils/dates';

// One service of the health overview: its state and when it was last seen working. The
// reason of a failed check is the tooltip.
export default function HomeServiceState({ health }: { health: SystemServiceHealth }) {
  const t = useTranslations('god.systemHealth');
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
      <span className="font-medium">{t(`service.${health.service}`)}</span>
      <span className="ms-auto text-xs text-muted-foreground">
        {health.lastSeenAt
          ? t(health.state === 'ok' ? 'seen' : 'lastSeen', {
              time: formatDurationShort(health.lastSeenAt),
            })
          : t('neverSeen')}
      </span>
    </li>
  );
}
