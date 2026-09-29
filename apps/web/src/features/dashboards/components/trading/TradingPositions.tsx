'use client';

import { Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, Inline, Pill, Stack, Table, Td, Text, Th, Tr } from '@/design-system';
import type { TradingAccountData, TradingPositionData } from '@/lib/api/endpoints/trading';
import { formatMoney, formatPercent, formatQuantity, pnlTone } from '../../utils/tradingFormat';
import { ApprovalPill } from './TradingPills';

// The open positions with the stop that protects each one. A position without a stop is
// marked: it is the one thing on this page worth acting on first (by the agents, not here).
export default function TradingPositions({
  data,
  currency,
}: {
  data: TradingPositionData[];
  currency: TradingAccountData['currency'];
}) {
  const t = useTranslations('dashboards.trading.widgets.positions');
  const locale = useLocale();
  if (data.length === 0)
    return (
      <EmptyState fill={false} icon={<Wallet />}>
        {t('empty')}
      </EmptyState>
    );
  const price = (value: number) => formatMoney(value, currency, locale);
  return (
    <Table label={t('title')}>
      <thead>
        <tr>
          <Th>{t('symbol')}</Th>
          <Th alignment="end">{t('qty')}</Th>
          <Th alignment="end">{t('entry')}</Th>
          <Th alignment="end">{t('price')}</Th>
          <Th alignment="end">{t('pnl')}</Th>
          <Th>{t('stop')}</Th>
          <Th>{t('strategy')}</Th>
        </tr>
      </thead>
      <tbody>
        {data.map((position) => (
          <Tr key={position.symbol}>
            <Td label={t('symbol')}>
              <Text weight="semibold">{position.symbol}</Text>
            </Td>
            <Td label={t('qty')} alignment="end">
              <Text tabular>{formatQuantity(position.qty, locale)}</Text>
            </Td>
            <Td label={t('entry')} alignment="end">
              <Text tabular>{price(position.entryPrice)}</Text>
            </Td>
            <Td label={t('price')} alignment="end">
              <Text tabular>{price(position.currentPrice)}</Text>
            </Td>
            <Td label={t('pnl')} alignment="end">
              <Stack gap={0} align="end">
                <Text tabular tone={pnlTone(position.unrealizedPnlUsd)}>
                  {formatMoney(position.unrealizedPnlUsd, currency, locale, { sign: true })}
                </Text>
                <Text size="xs" tabular tone="faint">
                  {formatPercent(position.unrealizedPnlPct, locale, { sign: true })}
                </Text>
              </Stack>
            </Td>
            <Td label={t('stop')}>
              {position.stopPrice != null ? (
                <Text tabular>{price(position.stopPrice)}</Text>
              ) : (
                <Pill tone="warning">{t('noStop')}</Pill>
              )}
            </Td>
            <Td label={t('strategy')}>
              {position.strategy ? (
                <Inline gap={2} wrap>
                  <Text mono>
                    {position.strategy}
                    {position.strategyVersion ? ` v${position.strategyVersion}` : ''}
                  </Text>
                  <ApprovalPill status={position.approvalStatus} />
                </Inline>
              ) : (
                <Text tone="faint">{t('noStrategy')}</Text>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
