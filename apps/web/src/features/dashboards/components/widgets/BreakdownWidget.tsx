import { Cell, Pie, PieChart } from 'recharts';
import { useTranslations } from 'next-intl';
import type { BreakdownBy, WidgetConfig } from '@/utils/dashboardWidgets';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import { useBreakdownQuery } from '../../services/analytics.service';
import { Inline, Stack, Text } from '@/design-system';

// The dimensions the counts can be grouped by, in picker order. Their labels are
// messages under `dashboards.breakdown.by`.
export const BY_OPTIONS: BreakdownBy[] = ['status', 'priority', 'type', 'assignee', 'delegate'];

// Issue counts grouped by a chosen dimension, drawn as a donut. The dimension is a
// per-widget config choice, edited from the header settings popover (see
// BreakdownWidgetSettings) and persisted on save.
export default function BreakdownWidget({
  projectKey,
  config,
}: {
  projectKey: string;
  config: WidgetConfig;
}) {
  const t = useTranslations('dashboards.breakdown');
  const by = config.by ?? 'status';
  const { data, isLoading } = useBreakdownQuery(projectKey, by);
  // An empty status bucket is still a board column, so keep it; other dimensions drop zeros.
  const items = (data ?? []).filter((i) => by === 'status' || i.count > 0);
  const total = items.reduce((sum, i) => sum + i.count, 0);
  const priorityLabel = usePriorityLabel();
  // The API names the buckets in English; the ones this app can name itself (the
  // priorities, the "none" buckets) are worded in the reader's language. Status, type
  // and people keep the names they were given.
  const label = (item: { key: string; label: string }) => {
    if (by === 'priority') return priorityLabel(item.key === 'none' ? null : item.key);
    if (item.key === 'none' && (by === 'type' || by === 'assignee' || by === 'delegate'))
      return t(`none.${by}`);
    return item.label;
  };
  const chartData = items.map((i, idx) => ({
    name: label(i),
    value: i.count,
    // Status and type carry their entity color; other dimensions use Helena tokens.
    fill:
      i.color ??
      [
        'var(--dashboard-project)',
        'var(--dashboard-positive)',
        'var(--dashboard-attention)',
        'var(--status-waiting)',
      ][idx % 4],
  }));

  function chart() {
    if (isLoading) return <Skeleton className="mx-auto h-[160px] w-[160px] rounded-full" />;
    if (total === 0) {
      return (
        <Text as="p" size="sm" tone="muted" className="py-6 text-center">
          {t('empty')}
        </Text>
      );
    }
    return (
      <Stack gap={3} className="items-center sm:flex-row">
        {/* Recharts draws to absolute SVG coordinates and does not read the document
            direction, so a mirrored chart would put its slices and legend out of step
            with each other. The labels and the tooltip are still translated. */}
        <ChartContainer dir="ltr" config={{}} className="aspect-square h-[160px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
            <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={45} strokeWidth={2}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <Stack as="ul" gap={1} className="min-w-0 flex-1 text-sm">
          {chartData.map((d, i) => (
            <Inline as="li" gap={2} key={i}>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.fill }} />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-muted-foreground tabular-nums">{d.value}</span>
            </Inline>
          ))}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap={3}>
      <Text as="p" size="xs" tone="muted">
        {t(`caption.${by}`)}
      </Text>
      {chart()}
    </Stack>
  );
}
