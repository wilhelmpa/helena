'use client';

import { RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, IconButton, Inline, Stack, Text } from '@/design-system';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  TradingPeriod,
  TradingWidgetDataMap,
  TradingWidgetId,
} from '@/lib/api/endpoints/trading';
import { useTradingWidget, type TradingWidgetState } from '../hooks/useTradingWidgets';
import { formatTradingTime } from '../utils/tradingFormat';
import TradingAccount from './trading/TradingAccount';
import TradingDecisions from './trading/TradingDecisions';
import TradingHistory from './trading/TradingHistory';
import TradingOrders from './trading/TradingOrders';
import TradingPositions from './trading/TradingPositions';
import TradingProblem from './trading/TradingProblem';
import TradingStrategies from './trading/TradingStrategies';

// One of the six trading widgets: its numbers from the shared answer, or the reason it has
// none. On the trading page it sits in a card of its own (`framed`); in the dashboard grid
// the grid's frame already holds title and border, so only the body is drawn.
export default function TradingDataWidget({
  id,
  projectKey,
  period,
  credentialId,
  onCredentialChange,
  framed = true,
}: {
  id: TradingWidgetId;
  projectKey: string;
  period: TradingPeriod;
  credentialId?: number;
  onCredentialChange: (credentialId: number) => void;
  framed?: boolean;
}) {
  const t = useTranslations('dashboards.trading.widgets');
  const locale = useLocale();
  const { state, updatedAt, refetch, refetching } = useTradingWidget(
    id,
    projectKey,
    period,
    credentialId,
  );
  // The account's currency for prices in the positions and orders tables; the answer is one
  // request, so the account is read from the same cache.
  const account = useTradingWidget('account', projectKey, period, credentialId).state;
  const positions = useTradingWidget('positions', projectKey, period, credentialId).state;
  const currency = account.status === 'ready' ? account.data.currency : 'USD';

  let body;
  if (state.status === 'loading') body = <Skeleton className="h-40 w-full" />;
  else if (state.status === 'problem')
    body = (
      <TradingProblem
        problem={state.problem}
        credentialId={credentialId}
        onCredentialChange={onCredentialChange}
        onRetry={refetch}
        retrying={refetching}
      />
    );
  else body = renderData(id, state, { currency, period, positions });

  if (!framed) return <Stack gap={3}>{body}</Stack>;
  return (
    <Card
      title={t(`${id}.title`)}
      meta={id === 'history' ? t(`history.periodMeta.${period}`) : undefined}
      actions={
        <Inline gap={2}>
          {updatedAt && state.status === 'ready' && (
            <Text size="xs" tone="faint" tabular>
              {t('updatedAt', { time: formatTradingTime(updatedAt, locale, 'short') })}
            </Text>
          )}
          <IconButton
            label={t('refresh')}
            size="small"
            onClick={refetch}
            disabled={refetching}
            aria-busy={refetching}
          >
            <RefreshCw size={14} />
          </IconButton>
        </Inline>
      }
    >
      {body}
    </Card>
  );
}

function renderData<K extends TradingWidgetId>(
  id: K,
  state: Extract<TradingWidgetState<K>, { status: 'ready' }>,
  context: {
    currency: string;
    period: TradingPeriod;
    positions: TradingWidgetState<'positions'>;
  },
) {
  const data = state.data as TradingWidgetDataMap[TradingWidgetId];
  switch (id) {
    case 'account':
      return (
        <TradingAccount
          data={data as TradingWidgetDataMap['account']}
          positions={context.positions.status === 'ready' ? context.positions.data : null}
        />
      );
    case 'positions':
      return (
        <TradingPositions
          data={data as TradingWidgetDataMap['positions']}
          currency={context.currency}
        />
      );
    case 'orders':
      return (
        <TradingOrders data={data as TradingWidgetDataMap['orders']} currency={context.currency} />
      );
    case 'history':
      return (
        <TradingHistory data={data as TradingWidgetDataMap['history']} period={context.period} />
      );
    case 'strategies':
      return <TradingStrategies data={data as TradingWidgetDataMap['strategies']} />;
    case 'decisions':
      return <TradingDecisions data={data as TradingWidgetDataMap['decisions']} />;
  }
}
