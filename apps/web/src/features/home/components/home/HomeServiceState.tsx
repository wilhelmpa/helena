import { useTranslations } from 'next-intl';
import type { SystemServiceHealth } from '@/lib/api/endpoints/god';
import { formatDurationShort } from '@/utils/dates';
import StatusBadge from '@/components/common/page/StatusBadge';
import { healthStatus } from '../../utils/systemHealth';
import { Inline, Text } from '@/design-system';

// One service of the health overview: its state and when it was last seen working. A
// report, not a control — no frame, no hover, nothing to click. The reason of a failed
// check is the tooltip.
export default function HomeServiceState({ health }: { health: SystemServiceHealth }) {
  const t = useTranslations('god.systemHealth');
  return (
    <Inline
      as="li"
      gap={2}
      padX={2}
      className="h-8 min-w-0 text-sm"
      title={health.error ?? undefined}
    >
      <StatusBadge status={healthStatus(health.state)} dotOnly />
      <span className="min-w-0 truncate">{t(`service.${health.service}`)}</span>
      <Text as="span" size="xs" tone="muted" className="ms-auto shrink-0">
        {health.lastSeenAt
          ? t(health.state === 'ok' ? 'seen' : 'lastSeen', {
              time: formatDurationShort(health.lastSeenAt),
            })
          : t('neverSeen')}
      </Text>
    </Inline>
  );
}
