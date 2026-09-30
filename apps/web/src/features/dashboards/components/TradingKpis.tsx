import { useLocale, useTranslations } from 'next-intl';
import { Grid, Tile } from '@/design-system';
import type { TradingDashboardData, TradingPeriod } from '@/lib/api/endpoints/trading';

// The four signal figures of the period: signals, vetos, what the signals would have made
// on paper, and the decisions taken.
export default function TradingKpis({
  data,
  period,
}: {
  data: TradingDashboardData;
  period: TradingPeriod;
}) {
  const t = useTranslations('dashboards.trading');
  const locale = useLocale();
  const result = data.hypotheticalPercent;
  const signalLabel: Record<TradingPeriod, 'signalsToday' | 'signalsWeek' | 'signalsPilot'> = {
    today: 'signalsToday',
    week: 'signalsWeek',
    pilot: 'signalsPilot',
  };
  return (
    <Grid min="fit">
      <Tile
        label={t(signalLabel[period])}
        value={String(data.signals.count)}
        note={data.signals.note ?? t('noData')}
        tone="positive"
      />
      <Tile
        label={t('vetos')}
        value={String(data.vetos.count)}
        note={data.vetos.note ?? t('noData')}
        tone="attention"
      />
      <Tile
        label={t('hypothetical')}
        value={
          result == null
            ? '–'
            : `${result >= 0 ? '+' : ''}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(result)} %`
        }
        note={result == null ? t('noData') : t('paperPeriod')}
      />
      <Tile
        label={t('decisions')}
        value={String(data.decisions.total)}
        note={t('decisionsNote', { safe: data.decisions.safe, fallback: data.decisions.fallback })}
      />
    </Grid>
  );
}
