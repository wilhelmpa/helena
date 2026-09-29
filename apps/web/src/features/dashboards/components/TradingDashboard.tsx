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
import TradingDataWidget from './TradingDataWidget';
import type { TradingWidgetId } from '@/lib/api/endpoints/trading';
import styles from './TradingDashboard.module.css';
import { Plus } from 'lucide-react';
import { Grid, Page, PageActions, PageTabs, Stack, Text } from '@/design-system';

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
  const hasOriginalWidget = ['kpis', 'watchlist', 'takt'].some(has);
  const data = useQuery({
    queryKey: ['trading-dashboard', projectKey, period],
    queryFn: () => getTradingDashboard(projectKey, period),
    enabled: hasOriginalWidget,
  });
  // The page template (docs/ui-framework.md): the header names the dashboard, the
  // period is the toolbar's tabs, adding a widget is the page's action.
  return (
    <Page
      variant="default"
      toolbar={
        <PageTabs<TradingPeriod>
          label={t('period')}
          value={period}
          onChange={setPeriod}
          items={[
            { value: 'today', label: t('today') },
            { value: 'week', label: t('week') },
            { value: 'pilot', label: t('pilot') },
          ]}
        />
      }
      actions={
        canEdit ? (
          <PageActions
            actions={[
              { id: 'add-widget', label: t('addWidget'), icon: Plus, onClick: onAddWidget },
            ]}
          />
        ) : undefined
      }
    >
      <Stack gap={5} grow data-trading-dashboard="" className={styles.trading}>
        {data.isLoading && <Text tone="faint">{t('loading')}</Text>}
        {data.isError && <Text tone="danger">{t('dataError')}</Text>}
        {data.data && (
          <>
            {has('kpis') && <TradingKpis data={data.data} period={period} />}
            {has('watchlist') && has('takt') ? (
              <Grid gap={4} split>
                <TradingWatchlist data={data.data} period={period} />
                <TradingTakt data={data.data} />
              </Grid>
            ) : (
              <Stack gap={4}>
                {has('watchlist') && <TradingWatchlist data={data.data} period={period} />}
                {has('takt') && <TradingTakt data={data.data} />}
              </Stack>
            )}
          </>
        )}
        {(
          [
            'account',
            'positions',
            'orders',
            'history',
            'strategies',
            'decisions',
          ] as TradingWidgetId[]
        )
          .filter(has)
          .map((id) => (
            <TradingDataWidget
              key={id}
              id={id}
              projectKey={projectKey}
              period={period}
              credentialId={
                dashboard.layout.find(
                  (item) => item.config?.pluginWidgetId === `plugin:helena.trading:${id}`,
                )?.config?.credentialId
              }
            />
          ))}
      </Stack>
    </Page>
  );
}
