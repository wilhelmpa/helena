import type { TradingDashboardData, TradingPeriod } from '@/lib/api/endpoints/trading';
import { useLocale, useTranslations } from 'next-intl';

export default function TradingWatchlist({
  data,
  period,
}: {
  data: TradingDashboardData;
  period: TradingPeriod;
}) {
  const t = useTranslations('dashboards.trading');
  const locale = useLocale();
  const title: Record<TradingPeriod, 'watchlistToday' | 'watchlistWeek' | 'watchlistPilot'> = {
    today: 'watchlistToday',
    week: 'watchlistWeek',
    pilot: 'watchlistPilot',
  };
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 20,
        borderRadius: 18,
        background: 'var(--trading-card)',
        boxShadow: '0 0 0 1px var(--trading-card-line)',
        minHeight: 0,
      }}
    >
      <h2
        style={{
          margin: 0,
          font: "500 10px 'JetBrains Mono', ui-monospace, monospace",
          letterSpacing: '.18em',
          color: 'var(--trading-label)',
        }}
      >
        {t(title[period])}
      </h2>
      {data.watchlist.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--trading-hint)' }}>{t('noData')}</p>
      )}
      {data.watchlist.map((bar) => {
        const color =
          bar.state === 'veto' || bar.rsi >= 70
            ? 'var(--trading-pink)'
            : bar.state === 'signal'
              ? 'var(--trading-green)'
              : bar.direction === '↘'
                ? 'var(--trading-hint)'
                : 'var(--trading-lavender)';
        const state =
          bar.state === 'veto'
            ? t('vetoState')
            : bar.state === 'signal'
              ? t('signalState')
              : bar.direction;
        return (
          <div
            key={bar.symbol}
            style={{
              display: 'grid',
              gridTemplateColumns: '60px minmax(0, 1fr) 120px',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 520 }}>{bar.symbol}</span>
            <span
              style={{
                height: 8,
                borderRadius: 99,
                background: 'var(--trading-bar)',
                overflow: 'hidden',
                display: 'block',
              }}
            >
              <span
                style={{
                  display: 'block',
                  height: '100%',
                  width: `${bar.rsi}%`,
                  borderRadius: 99,
                  background: color,
                }}
              />
            </span>
            <span
              style={{
                font: "400 11px 'JetBrains Mono', ui-monospace, monospace",
                color: 'var(--trading-soft)',
                textAlign: 'right',
              }}
            >
              {t('rsiLabel')}{' '}
              {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bar.rsi)} ·{' '}
              {state}
            </span>
          </div>
        );
      })}
      <p style={{ margin: 'auto 0 0', fontSize: 12, color: 'var(--trading-hint)' }}>
        {t('rsiNote')}
      </p>
    </section>
  );
}
