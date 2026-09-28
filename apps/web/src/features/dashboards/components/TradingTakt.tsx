import type { TradingDashboardData } from '@/lib/api/endpoints/trading';
import { useTranslations } from 'next-intl';

function time(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('de-DE', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '–';
}

export default function TradingTakt({ data }: { data: TradingDashboardData }) {
  const t = useTranslations('dashboards.trading');
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 20,
        borderRadius: 18,
        background: 'var(--trading-card)',
        boxShadow: '0 0 0 1px var(--trading-card-line)',
        minHeight: 0,
      }}
    >
      <h2
        style={{
          margin: '0 0 4px',
          font: "500 10px 'JetBrains Mono', ui-monospace, monospace",
          letterSpacing: '.18em',
          color: 'var(--trading-label)',
        }}
      >
        {t('takt')}
      </h2>
      {data.schedules.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--trading-hint)' }}>{t('noData')}</p>
      )}
      {data.schedules.map((schedule) => {
        const dot = !schedule.enabled
          ? 'var(--trading-hint)'
          : schedule.status === 'running'
            ? 'var(--trading-working)'
            : schedule.status === 'failed'
              ? 'var(--trading-pink)'
              : 'var(--trading-lavender)';
        return (
          <div
            key={schedule.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minHeight: 36,
              padding: '4px 12px',
              borderRadius: 12,
              background: 'var(--trading-surface)',
              fontSize: 12,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                flex: '0 0 7px',
                borderRadius: '50%',
                background: dot,
                boxShadow: `0 0 8px ${dot}`,
              }}
            />
            <span style={{ flexGrow: 1, minWidth: 0, color: 'var(--trading-secondary)' }}>
              {schedule.title}
            </span>
            <span
              style={{
                font: "400 10px 'JetBrains Mono', ui-monospace, monospace",
                color: 'var(--trading-hint)',
                textAlign: 'right',
                whiteSpace: 'nowrap',
              }}
            >
              {t('last')} {time(schedule.lastRunAt)}
              <br />
              {t('next')} {time(schedule.nextRunAt)}
            </span>
          </div>
        );
      })}
    </section>
  );
}
