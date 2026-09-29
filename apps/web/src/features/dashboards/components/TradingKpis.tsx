import type { TradingDashboardData, TradingPeriod } from '@/lib/api/endpoints/trading';
import { useLocale, useTranslations } from 'next-intl';

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
  const items = [
    {
      label: t(signalLabel[period]),
      value: String(data.signals.count),
      note: data.signals.note ?? t('noData'),
      color: 'var(--trading-green)',
    },
    {
      label: t('vetos'),
      value: String(data.vetos.count),
      note: data.vetos.note ?? t('noData'),
      color: 'var(--trading-pink)',
    },
    {
      label: t('hypothetical'),
      value:
        result == null
          ? '–'
          : `${result >= 0 ? '+' : ''}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(result)} %`,
      note: result == null ? t('noData') : t('paperPeriod'),
      color: 'var(--trading-text)',
    },
    {
      label: t('decisions'),
      value: String(data.decisions.total),
      note: t('decisionsNote', { safe: data.decisions.safe, fallback: data.decisions.fallback }),
      color: 'var(--trading-text)',
    },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '18px 20px',
            minHeight: 127,
            borderRadius: 'var(--radius-xl)',
            background: 'var(--trading-card)',
            boxShadow: '0 0 0 1px var(--trading-card-line)',
          }}
        >
          <span
            style={{
              font: "500 10px 'JetBrains Mono', ui-monospace, monospace",
              letterSpacing: '.18em',
              color: 'var(--trading-label)',
            }}
          >
            {item.label}
          </span>
          <span
            style={{
              fontSize: 34,
              lineHeight: '39px',
              fontWeight: 520,
              letterSpacing: '-.05em',
              color: item.color,
            }}
          >
            {item.value}
          </span>
          <span style={{ fontSize: 12, color: 'var(--trading-muted)' }}>{item.note}</span>
        </div>
      ))}
    </div>
  );
}
