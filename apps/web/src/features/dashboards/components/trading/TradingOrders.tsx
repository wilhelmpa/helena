'use client';

import { useState } from 'react';
import { NotebookText, ReceiptText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ButtonLink,
  EmptyState,
  Inline,
  Segmented,
  Stack,
  Table,
  Td,
  Text,
  Th,
  Tr,
} from '@/design-system';
import type { TradingOrderData, TradingOrdersData } from '@/lib/api/endpoints/trading';
import { vaultNotePath } from '@/utils/paths';
import { formatMoney, formatQuantity, formatTradingTime } from '../../utils/tradingFormat';
import { OrderStatusPill } from './TradingPills';

type Scope = 'open' | 'today' | 'recent';

// The orders of the paper account: open ones first, then today's, then the latest. Each
// order names its strategy and, when the agent wrote one, links its journal entry. Nothing
// here places, changes or cancels an order.
export default function TradingOrders({
  data,
  currency,
}: {
  data: TradingOrdersData;
  currency: string;
}) {
  const t = useTranslations('dashboards.trading.widgets.orders');
  const locale = useLocale();
  const [scope, setScope] = useState<Scope>('open');
  const rows: TradingOrderData[] = data[scope];
  const money = (value: number) => formatMoney(value, currency, locale);
  const kind = (order: TradingOrderData) =>
    order.type === 'market' ||
    order.type === 'limit' ||
    order.type === 'stop' ||
    order.type === 'stop_limit' ||
    order.type === 'trailing_stop'
      ? t(`type.${order.type}`)
      : order.type;
  const price = (order: TradingOrderData) => {
    const parts = [
      order.limitPrice != null ? `${t('limit')} ${money(order.limitPrice)}` : null,
      order.stopPrice != null ? `${t('stopPrice')} ${money(order.stopPrice)}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : t('atMarket');
  };
  return (
    <Stack gap={3}>
      <Segmented<Scope>
        label={t('scope')}
        value={scope}
        onChange={setScope}
        options={(['open', 'today', 'recent'] as const).map((value) => ({
          value,
          label: `${t(`scopes.${value}`)} · ${data[value].length}`,
        }))}
      />
      {rows.length === 0 ? (
        <EmptyState fill={false} icon={<ReceiptText />}>
          {t(`empty.${scope}`)}
        </EmptyState>
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr>
              <Th>{t('symbol')}</Th>
              <Th>{t('side')}</Th>
              <Th>{t('kind')}</Th>
              <Th alignment="end">{t('qty')}</Th>
              <Th>{t('price')}</Th>
              <Th>{t('statusLabel')}</Th>
              <Th>{t('time')}</Th>
              <Th>{t('strategy')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((order) => (
              <Tr key={order.id}>
                <Td label={t('symbol')}>
                  <Text weight="semibold">{order.symbol}</Text>
                </Td>
                <Td label={t('side')}>
                  <Text tone={order.side === 'buy' ? 'success' : 'danger'}>
                    {order.side === 'buy' || order.side === 'sell'
                      ? t(`sides.${order.side}`)
                      : order.side}
                  </Text>
                </Td>
                <Td label={t('kind')}>
                  <Text>{kind(order)}</Text>
                </Td>
                <Td label={t('qty')} alignment="end">
                  <Text tabular>{order.qty == null ? '–' : formatQuantity(order.qty, locale)}</Text>
                </Td>
                <Td label={t('price')}>
                  <Text tabular>{price(order)}</Text>
                </Td>
                <Td label={t('statusLabel')}>
                  <OrderStatusPill status={order.status} />
                </Td>
                <Td label={t('time')}>
                  <Text tabular tone="muted">
                    {formatTradingTime(order.submittedAt, locale)}
                  </Text>
                </Td>
                <Td label={t('strategy')}>
                  <Inline gap={2} wrap>
                    {order.strategy ? (
                      <Text mono>
                        {order.strategy}
                        {order.strategyVersion ? ` v${order.strategyVersion}` : ''}
                      </Text>
                    ) : (
                      <Text tone="faint">{t('noStrategy')}</Text>
                    )}
                    {order.journalPath && (
                      <ButtonLink
                        href={vaultNotePath(order.journalPath)}
                        variant="ghost"
                        size="small"
                        icon={<NotebookText size={14} />}
                      >
                        {t('journal')}
                      </ButtonLink>
                    )}
                  </Inline>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Stack>
  );
}
