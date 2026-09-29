'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { WidgetInstance } from '@/utils/dashboardWidgets';
import { getTradingDashboard } from '@/lib/api/endpoints/trading';
import { usePluginUiSlotsQuery } from '@/services/plugins.service';
import { pluginDashboardWidget } from '@/extensions/pluginDashboardWidgets';
import TradingKpis from './TradingKpis';
import TradingWatchlist from './TradingWatchlist';
import TradingTakt from './TradingTakt';
import TradingDataWidget from './TradingDataWidget';
import type { TradingWidgetId } from '@/lib/api/endpoints/trading';
import styles from './TradingDashboard.module.css';
import { Text } from '@/design-system';

export default function ProjectPluginWidget({
  widget,
  projectKey,
}: {
  widget: WidgetInstance;
  projectKey: string;
}) {
  const t = useTranslations('dashboards.trading');
  const slots = usePluginUiSlotsQuery();
  const pluginWidget = (slots.data ?? [])
    .map((slot) => pluginDashboardWidget(slot, 'project'))
    .find((entry) => entry?.id === widget.config?.pluginWidgetId);
  const trading = pluginWidget?.pluginId === 'helena.trading';
  const originalTrading =
    trading && ['kpis', 'watchlist', 'takt'].some((id) => pluginWidget?.id.endsWith(`:${id}`));
  const data = useQuery({
    queryKey: ['trading-dashboard', projectKey, 'today'],
    queryFn: () => getTradingDashboard(projectKey, 'today'),
    enabled: originalTrading,
  });
  if (!pluginWidget)
    return (
      <Text as="p" size="xs" tone="muted">
        {t('unavailable')}
      </Text>
    );
  if (trading) {
    const id = pluginWidget.id.split(':').at(-1) as TradingWidgetId;
    if (['account', 'positions', 'orders', 'history', 'strategies', 'decisions'].includes(id))
      return (
        <TradingDataWidget
          id={id}
          projectKey={projectKey}
          period="today"
          credentialId={widget.config?.credentialId}
        />
      );
    if (!data.data)
      return (
        <Text as="p" size="xs" tone="muted">
          {t('loading')}
        </Text>
      );
    if (pluginWidget.id.endsWith(':kpis'))
      return (
        <div className={styles.trading}>
          <TradingKpis data={data.data} period="today" />
        </div>
      );
    if (pluginWidget.id.endsWith(':watchlist'))
      return (
        <div className={styles.trading}>
          <TradingWatchlist data={data.data} period="today" />
        </div>
      );
    if (pluginWidget.id.endsWith(':takt'))
      return (
        <div className={styles.trading}>
          <TradingTakt data={data.data} />
        </div>
      );
  }
  if (pluginWidget.view.kind !== 'frame') return null;
  const src = new URL(pluginWidget.view.url);
  src.searchParams.set('projectKey', projectKey);
  return (
    <iframe
      title={widget.title ?? t('unavailable')}
      src={src.toString()}
      sandbox="allow-scripts allow-forms"
      className="h-full w-full border-0"
    />
  );
}
