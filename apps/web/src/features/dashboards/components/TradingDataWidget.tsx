'use client';

import { useQuery } from '@tanstack/react-query';
import { Text } from '@/design-system';
import {
  getTradingWidgets,
  type TradingPeriod,
  type TradingWidgetId,
} from '@/lib/api/endpoints/trading';
import { vaultNotePath } from '@/utils/paths';

const titles: Record<TradingWidgetId, string> = {
  account: 'Konto',
  positions: 'Offene Positionen',
  orders: 'Orders',
  history: 'Ergebnis-Verlauf',
  strategies: 'Strategien & Freigaben',
  decisions: 'Entscheidungen',
};

export default function TradingDataWidget({
  id,
  projectKey,
  period,
  credentialId,
}: {
  id: TradingWidgetId;
  projectKey: string;
  period: TradingPeriod;
  credentialId?: number;
}) {
  const result = useQuery({
    queryKey: ['trading-widgets', projectKey, period, credentialId],
    queryFn: () => getTradingWidgets(projectKey, period, credentialId),
    staleTime: 15_000,
  });
  const widget = result.data?.[id];
  const orders =
    id === 'orders' && widget?.data && typeof widget.data === 'object'
      ? (widget.data as { recent?: { id: string; journalPath: string | null }[] })
      : null;
  return (
    <section>
      <Text as="h3" weight="semibold">
        {titles[id]}
      </Text>
      {result.isPending && <Text>{'Loading…'}</Text>}
      {result.isError && <Text tone="danger">{result.error.message}</Text>}
      {widget?.error && <Text tone="danger">{widget.error}</Text>}
      {widget?.data != null && <Text as="pre">{JSON.stringify(widget.data, null, 2)}</Text>}
      {orders?.recent
        ?.filter((order) => order.journalPath)
        .map((order) => (
          <a key={order.id} href={vaultNotePath(order.journalPath!)}>
            {'Journal'} {order.id}
          </a>
        ))}
    </section>
  );
}
