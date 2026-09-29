import { useLocale, useTranslations } from 'next-intl';
import { Card, EmptyState, List, ListRow, Stack, Text } from '@/design-system';
import type { TradingDashboardData } from '@/lib/api/endpoints/trading';

// The clock of the trading routines: when each one last ran and when it runs next. A running
// routine shows the working dot, a failed one the error dot; a switched-off one is greyed.
export default function TradingTakt({
  data,
  framed = true,
}: {
  data: TradingDashboardData;
  // In a card of its own (the trading page); the dashboard grid frames its widgets itself.
  framed?: boolean;
}) {
  const t = useTranslations('dashboards.trading');
  const locale = useLocale();
  const time = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
          new Date(value),
        )
      : '–';
  const body = (
    <>
      {data.schedules.length === 0 ? (
        <EmptyState fill={false}>{t('noData')}</EmptyState>
      ) : (
        <List label={t('takt')}>
          {data.schedules.map((schedule) => (
            <ListRow
              key={schedule.id}
              title={<Text tone={schedule.enabled ? 'default' : 'faint'}>{schedule.title}</Text>}
              dot={
                !schedule.enabled
                  ? null
                  : schedule.status === 'running'
                    ? 'working'
                    : schedule.status === 'failed'
                      ? 'error'
                      : null
              }
              subtitle={
                <Stack gap={0}>
                  <Text size="xs" tone="faint" tabular>
                    {t('last')} {time(schedule.lastRunAt)} · {t('next')} {time(schedule.nextRunAt)}
                  </Text>
                </Stack>
              }
            />
          ))}
        </List>
      )}
    </>
  );
  return framed ? <Card title={t('takt')}>{body}</Card> : body;
}
