import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { PulseUnit } from '@/lib/api/endpoints/analytics';
import type { WidgetConfig } from '@/utils/dashboardWidgets';
import { Skeleton } from '@/components/ui/skeleton';
import { MonoMeta } from '@/components/helena/DashboardPrimitives';
import { usePulseQuery } from '../../services/analytics.service';
import { Inline, Stack } from '@/design-system';

const ROWS: Record<PulseUnit, number> = { hour: 24, day: 7, week: 4 };
const COLUMNS = 14;

// A compact pulse: one vertical bar per time column instead of a large cell field.
// The query and granularity are the same as the former heatmap widget.
export default function PulseWidget({
  projectKey,
  config,
}: {
  projectKey: string;
  config: WidgetConfig;
}) {
  const t = useTranslations('dashboards.pulse');
  const unit = config.granularity ?? 'day';
  const { data, isLoading } = usePulseQuery(projectKey, unit, COLUMNS);
  const { columns, total, active, max } = useMemo(() => {
    const buckets = data ?? [];
    const rows = ROWS[unit];
    const columns: { label: string; count: number }[] = [];
    for (let i = 0; i < buckets.length; i += rows) {
      const group = buckets.slice(i, i + rows);
      columns.push({
        label: group.at(-1)?.label ?? '',
        count: group.reduce((sum, b) => sum + b.count, 0),
      });
    }
    return {
      columns: columns.slice(-COLUMNS),
      total: buckets.reduce((sum, b) => sum + b.count, 0),
      active: buckets.filter((b) => b.count > 0).length,
      max: Math.max(1, ...columns.map((column) => column.count)),
    };
  }, [data, unit]);

  return (
    <Stack gap={4}>
      <MonoMeta>{t(`caption.${unit}`)}</MonoMeta>
      {isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <Inline
          gap={2}
          align="end"
          className="h-28"
          role="img"
          aria-label={t('events', { count: total })}
        >
          {columns.map((column, index) => (
            <span
              key={`${column.label}-${index}`}
              title={`${column.label}: ${column.count}`}
              className="min-h-1 flex-1 rounded-t-md bg-[var(--dashboard-positive)]"
              style={{
                height: `${Math.max(4, (column.count / max) * 100)}%`,
                opacity: column.count ? 0.45 + (column.count / max) * 0.55 : 0.15,
              }}
            />
          ))}
        </Inline>
      )}
      <MonoMeta className="text-[var(--dashboard-muted)]">
        {t('events', { count: total })} · {t('active', { count: active })}
      </MonoMeta>
    </Stack>
  );
}
