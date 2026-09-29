'use client';

import { LineChart } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, Inline, Stack, Text, TimeSeriesChart } from '@/design-system';
import type { TradingHistoryData, TradingPeriod } from '@/lib/api/endpoints/trading';
import { formatMoney, formatPercent, pnlTone } from '../../utils/tradingFormat';

// The equity curve of the paper account for the chosen period, with its change since the
// start of the period. Day and week come from the broker's own history; "Pilot" from the
// day the project began.
export default function TradingHistory({
  data,
  period,
}: {
  data: TradingHistoryData;
  period: TradingPeriod;
}) {
  const t = useTranslations('dashboards.trading.widgets.history');
  const locale = useLocale();
  const points = data.points
    .filter((point) => point.equity != null)
    .map((point) => ({ x: new Date(point.time).getTime(), y: point.equity as number }))
    .filter((point) => Number.isFinite(point.x));
  if (points.length < 2) {
    return (
      <EmptyState fill={false} icon={<LineChart />}>
        {t('empty')}
      </EmptyState>
    );
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const change = last.y - first.y;
  const changePct = first.y ? (change / first.y) * 100 : null;
  const money = (value: number) => formatMoney(value, data.currency, locale, { digits: 0 });
  const axis: Intl.DateTimeFormatOptions =
    period === 'today'
      ? { hour: '2-digit', minute: '2-digit' }
      : period === 'week'
        ? { weekday: 'short', hour: '2-digit' }
        : { day: '2-digit', month: '2-digit' };
  const tick = (x: number) => new Intl.DateTimeFormat(locale, axis).format(new Date(x));
  const tip = (x: number) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: period === 'pilot' ? undefined : '2-digit',
      minute: period === 'pilot' ? undefined : '2-digit',
    }).format(new Date(x));
  return (
    <Stack gap={3}>
      <Inline gap={5} wrap align="end">
        <Stack gap={0}>
          <Text size="xs" tone="muted">
            {t('current')}
          </Text>
          <Text size="lg" weight="semibold" tabular>
            {formatMoney(last.y, data.currency, locale)}
          </Text>
        </Stack>
        <Stack gap={0}>
          <Text size="xs" tone="muted">
            {t(`change.${period}`)}
          </Text>
          <Text size="lg" weight="semibold" tabular tone={pnlTone(change)}>
            {formatMoney(change, data.currency, locale, { sign: true })}
            {changePct != null && (
              <Text as="span" tabular tone={pnlTone(change)}>
                {' '}
                ({formatPercent(changePct, locale, { sign: true })})
              </Text>
            )}
          </Text>
        </Stack>
      </Inline>
      <TimeSeriesChart
        points={points}
        label={t('chart')}
        tone={change > 0 ? 'success' : change < 0 ? 'danger' : 'accent'}
        formatX={tick}
        formatTip={tip}
        formatY={money}
      />
    </Stack>
  );
}
