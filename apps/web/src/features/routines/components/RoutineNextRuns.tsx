import { useTranslations } from 'next-intl';
import { formatInZone, nextRuns } from '../utils/schedulePreview';
import { Text } from '@/design-system';

// The next times a cron fires in its zone, as the form is filled in.
export function RoutineNextRuns({ cron, timezone }: { cron: string; timezone: string }) {
  const t = useTranslations('routines');
  const runs = nextRuns(cron, timezone);
  if (runs.length === 0) return null;
  return (
    <Text as="p" size="xs" tone="muted">
      {t('nextRuns', { runs: runs.map((run) => formatInZone(run, timezone)).join(' · ') })}
    </Text>
  );
}
