import { useLocale, useTranslations } from 'next-intl';
import { Card, EmptyState, Inline, Stack, Text } from '@/design-system';
import BudgetBar from '@/components/helena/BudgetBar';
import type { TradingDashboardData, TradingPeriod } from '@/lib/api/endpoints/trading';
import styles from './TradingWatchlist.module.css';

// The watched symbols with their RSI: a bar from 0 to 100 that turns red from 70 (overbought,
// the strategy does not buy) and the state of the last check.
export default function TradingWatchlist({
  data,
  period,
  framed = true,
}: {
  data: TradingDashboardData;
  period: TradingPeriod;
  // In a card of its own (the trading page); the dashboard grid frames its widgets itself.
  framed?: boolean;
}) {
  const t = useTranslations('dashboards.trading');
  const locale = useLocale();
  const title: Record<TradingPeriod, 'watchlistToday' | 'watchlistWeek' | 'watchlistPilot'> = {
    today: 'watchlistToday',
    week: 'watchlistWeek',
    pilot: 'watchlistPilot',
  };
  const body = (
    <>
      {data.watchlist.length === 0 ? (
        <EmptyState fill={false}>{t('noData')}</EmptyState>
      ) : (
        <Stack gap={3}>
          {data.watchlist.map((bar) => {
            const overbought = bar.state === 'veto' || bar.rsi >= 70;
            const state =
              bar.state === 'veto'
                ? t('vetoState')
                : bar.state === 'signal'
                  ? t('signalState')
                  : bar.direction;
            return (
              <div key={bar.symbol} className={styles.row}>
                <Text weight="semibold">{bar.symbol}</Text>
                <BudgetBar
                  budget={{ ratio: bar.rsi / 100, warned: false, reached: overbought }}
                  label={`${t('rsiLabel')} ${bar.rsi}`}
                />
                <Inline justify="end">
                  <Text size="xs" mono tone={overbought ? 'danger' : 'muted'} tabular>
                    {t('rsiLabel')}{' '}
                    {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bar.rsi)} ·{' '}
                    {state}
                  </Text>
                </Inline>
              </div>
            );
          })}
          <Text size="xs" tone="faint">
            {t('rsiNote')}
          </Text>
        </Stack>
      )}
    </>
  );
  return framed ? <Card title={t(title[period])}>{body}</Card> : body;
}
