'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { Dashboard } from '@/lib/api/endpoints/dashboards';
import { getTradingDashboard, type TradingPeriod } from '@/lib/api/endpoints/trading';
import { usePluginUiSlotsQuery } from '@/services/plugins.service';
import { pluginDashboardWidget } from '@/extensions/pluginDashboardWidgets';
import TradingKpis from './TradingKpis';
import TradingWatchlist from './TradingWatchlist';
import TradingTakt from './TradingTakt';
import styles from './TradingDashboard.module.css';

export default function TradingDashboard({
  dashboard,
  projectKey,
  canEdit,
  onAddWidget,
}: {
  dashboard: Dashboard;
  projectKey: string;
  canEdit: boolean;
  onAddWidget: () => void;
}) {
  const t = useTranslations('dashboards.trading');
  const [period, setPeriod] = useState<TradingPeriod>('today');
  const slots = usePluginUiSlotsQuery();
  const widgets = (slots.data ?? [])
    .map((slot) => pluginDashboardWidget(slot, 'project'))
    .filter((widget) => widget?.pluginId === 'helena.trading');
  const ids = new Set(dashboard.layout.map((item) => item.config?.pluginWidgetId));
  const has = (id: string) =>
    widgets.some((widget) => widget?.id === `plugin:helena.trading:${id}` && ids.has(widget.id));
  const data = useQuery({
    queryKey: ['trading-dashboard', projectKey, period],
    queryFn: () => getTradingDashboard(projectKey, period),
    enabled: widgets.length > 0,
  });
  return (
    <main
      data-trading-dashboard=""
      className={styles.trading}
      style={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '26px 36px 24px',
        boxSizing: 'border-box',
        minWidth: 0,
        gap: 18,
        background: 'var(--trading-bg)',
        color: 'var(--trading-text)',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        overflowY: 'auto',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
        }}
      >
        <div>
          <p
            style={{
              font: "500 10px 'JetBrains Mono', ui-monospace, monospace",
              letterSpacing: '.23em',
              color: 'var(--trading-green)',
              margin: '0 0 10px',
            }}
          >
            {t('eyebrow')}
          </p>
          <h1
            style={{
              fontSize: 38,
              lineHeight: 1.04,
              letterSpacing: '-.05em',
              fontWeight: 520,
              margin: 0,
            }}
          >
            {t('title')}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div
            role="group"
            aria-label={t('period')}
            style={{
              display: 'flex',
              padding: 4,
              background: 'var(--trading-surface)',
              borderRadius: 13,
              boxShadow: '0 0 0 1px var(--trading-card-line)',
            }}
          >
            {(
              [
                ['today', t('today')],
                ['week', t('week')],
                ['pilot', t('pilot')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
                style={{
                  border: 0,
                  minHeight: 34,
                  padding: '0 12px',
                  borderRadius: 10,
                  font: '500 12px Inter, sans-serif',
                  color: period === value ? 'var(--trading-strong)' : 'var(--trading-inactive)',
                  background: period === value ? 'var(--trading-selected)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={onAddWidget}
              style={{
                minHeight: 42,
                padding: '0 16px',
                borderRadius: 99,
                background: 'var(--trading-raised)',
                border: '1px solid var(--trading-button-line)',
                color: 'var(--trading-secondary)',
                font: '500 12px Inter, sans-serif',
                cursor: 'pointer',
              }}
            >
              {t('addWidget')}
            </button>
          )}
        </div>
      </header>
      {data.isLoading && (
        <p style={{ color: 'var(--trading-hint)', fontSize: 12 }}>{t('loading')}</p>
      )}
      {data.isError && (
        <p style={{ color: 'var(--trading-pink)', fontSize: 12 }}>{t('dataError')}</p>
      )}
      {data.data && (
        <>
          {has('kpis') && <TradingKpis data={data.data} period={period} />}
          <div
            style={{
              flexGrow: 1,
              display: 'grid',
              gridTemplateColumns:
                has('watchlist') && has('takt')
                  ? 'minmax(0, 2fr) minmax(0, 1fr)'
                  : 'minmax(0, 1fr)',
              gap: 14,
              minHeight: 0,
            }}
          >
            {has('watchlist') && <TradingWatchlist data={data.data} period={period} />}
            {has('takt') && <TradingTakt data={data.data} />}
          </div>
        </>
      )}
    </main>
  );
}
