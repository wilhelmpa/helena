import { useTranslations } from 'next-intl';
import { formatInZone, nextRuns } from '../utils/schedulePreview';

// The next times a cron fires in its zone, as the form is filled in.
export function RoutineNextRuns({ cron, timezone }: { cron: string; timezone: string }) {
  const t = useTranslations('routines');
  const runs = nextRuns(cron, timezone);
  if (runs.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t('nextRuns', { runs: runs.map((run) => formatInZone(run, timezone)).join(' · ') })}
    </p>
  );
}
