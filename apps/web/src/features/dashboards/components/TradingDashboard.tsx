'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Dashboard } from '@/lib/api/endpoints/dashboards';
import {
  getTradingDashboard,
  type TradingPeriod,
  type TradingWidgetId,
} from '@/lib/api/endpoints/trading';
import { useUpdateDashboard } from '@/services/dashboards.service';
import { usePluginUiSlotsQuery } from '@/services/plugins.service';
import { pluginDashboardWidget } from '@/extensions/pluginDashboardWidgets';
import {
  Card,
  Grid,
  Page,
  PageActions,
  PageSelect,
  PageTabs,
  PageToolbarSpacer,
  Stack,
  Text,
} from '@/design-system';
import { usePaperConnections, useTradingWidgets } from '../hooks/useTradingWidgets';
import { problemOfMessage } from '../utils/tradingErrors';
import TradingProblem from './trading/TradingProblem';
import TradingKpis from './TradingKpis';
import TradingWatchlist from './TradingWatchlist';
import TradingTakt from './TradingTakt';
import TradingDataWidget from './TradingDataWidget';

const PREFIX = 'plugin:helena.trading:';
// The order of the cards on the page. The layout of the dashboard decides which are there.
const DATA_WIDGETS: TradingWidgetId[] = [
  'account',
  'history',
  'positions',
  'orders',
  'strategies',
  'decisions',
];
// The cards that read the paper account; strategies and decisions come from Ava itself.
const ACCOUNT_WIDGETS: TradingWidgetId[] = ['account', 'history', 'positions', 'orders'];

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
  const update = useUpdateDashboard(projectKey);
  const { connections } = usePaperConnections();
  const widgets = (slots.data ?? [])
    .map((slot) => pluginDashboardWidget(slot, 'project'))
    .filter((widget) => widget?.pluginId === 'helena.trading');
  const ids = new Set(dashboard.layout.map((item) => item.config?.pluginWidgetId));
  const has = (id: string) =>
    widgets.some((widget) => widget?.id === `${PREFIX}${id}` && ids.has(widget.id));
  const hasOriginalWidget = ['kpis', 'watchlist', 'takt'].some(has);
  const data = useQuery({
    queryKey: ['trading-dashboard', projectKey, period],
    queryFn: () => getTradingDashboard(projectKey, period),
    enabled: hasOriginalWidget,
  });

  // One paper account for the whole page: the choice saved in the layout, or the one just
  // made here. Saving it needs the right to edit the dashboard; without it the choice holds
  // until the page is left.
  const saved = dashboard.layout.find(
    (item) => item.config?.pluginWidgetId?.startsWith(PREFIX) && item.config.credentialId,
  )?.config?.credentialId;
  const [picked, setPicked] = useState<number | undefined>();
  const credentialId = picked ?? saved;
  function chooseConnection(id: number) {
    setPicked(id);
    if (!canEdit || id === saved) return;
    update.mutate({
      id: dashboard.id,
      input: {
        layout: dashboard.layout.map((item) =>
          item.config?.pluginWidgetId?.startsWith(PREFIX) &&
          DATA_WIDGETS.some((widget) => item.config?.pluginWidgetId === `${PREFIX}${widget}`)
            ? { ...item, config: { ...item.config, credentialId: id } }
            : item,
        ),
      },
    });
  }

  // No account chosen (several connections) or none set up: one prompt instead of four cards
  // that say the same. Strategies and decisions do not need the account and stay.
  const answer = useTradingWidgets(projectKey, period, credentialId);
  const accountError = answer.data?.account.error;
  const connectionProblem = accountError ? problemOfMessage(accountError) : null;
  const needsConnection =
    connectionProblem &&
    (connectionProblem.kind === 'selectConnection' || connectionProblem.kind === 'noConnection')
      ? connectionProblem
      : null;

  const card = (id: TradingWidgetId) => (
    <TradingDataWidget
      key={id}
      id={id}
      projectKey={projectKey}
      period={period}
      credentialId={credentialId}
      onCredentialChange={chooseConnection}
    />
  );
  const shown = DATA_WIDGETS.filter(has);
  const rendered: React.ReactNode[] = [];
  let prompted = false;
  for (const id of shown) {
    if (needsConnection && ACCOUNT_WIDGETS.includes(id)) {
      if (!prompted) {
        prompted = true;
        rendered.push(
          <Card key="connection" title={t('widgets.connection.label')}>
            <TradingProblem
              problem={needsConnection}
              credentialId={credentialId}
              onCredentialChange={chooseConnection}
              onRetry={() => void answer.refetch()}
              retrying={answer.isFetching}
            />
          </Card>,
        );
      }
      continue;
    }
    rendered.push(card(id));
  }

  // The page template (docs/ui-framework.md): the header names the dashboard, the
  // period and the account are the toolbar, adding a widget is the page's action.
  return (
    <Page
      variant="default"
      toolbar={
        <>
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
          {connections.length > 1 && (
            <>
              <PageToolbarSpacer />
              <PageSelect<string>
                label={t('widgets.connection.label')}
                icon={Landmark}
                value={credentialId ? String(credentialId) : ''}
                onChange={(value) => chooseConnection(Number(value))}
                options={[
                  ...(credentialId ? [] : [{ value: '', label: t('widgets.connection.choose') }]),
                  ...connections.map((connection) => ({
                    value: String(connection.id),
                    label: connection.label,
                  })),
                ]}
              />
            </>
          )}
        </>
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
      <Stack gap={5} grow data-trading-dashboard="">
        {data.isError && <Text tone="danger">{t('dataError')}</Text>}
        {rendered}
        {has('kpis') && data.data && <TradingKpis data={data.data} period={period} />}
        {(has('watchlist') || has('takt')) && data.data && (
          <>
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
        {hasOriginalWidget && data.isLoading && <Text tone="faint">{t('loading')}</Text>}
      </Stack>
    </Page>
  );
}
