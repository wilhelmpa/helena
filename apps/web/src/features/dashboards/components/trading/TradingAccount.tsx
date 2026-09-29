'use client';

import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Grid, Inline, Notice, Pill, Stack, Text, Tile } from '@/design-system';
import BudgetBar from '@/components/helena/BudgetBar';
import type { TradingAccountData, TradingPositionData } from '@/lib/api/endpoints/trading';
import { formatCount, formatMoney, formatPercent, usage } from '../../utils/tradingFormat';

const LIMIT_KEYS = [
  'maxOrderValueUsd',
  'maxPositionValueUsd',
  'maxRiskPerTradeUsd',
  'dailyLossLimitUsd',
] as const;

const isLimitKey = (key: string): key is (typeof LIMIT_KEYS)[number] =>
  (LIMIT_KEYS as readonly string[]).includes(key);

// The paper account at a glance: the figures, whether trading is stopped and why, and how
// much of each limit is used. Display only: the stop and the limits are changed where they
// are stored (Werkzeuge → Alpaca Paper), by the owner.
export default function TradingAccount({
  data,
  positions,
}: {
  data: TradingAccountData;
  // From the positions widget of the same answer; null while it has none.
  positions: TradingPositionData[] | null;
}) {
  const t = useTranslations('dashboards.trading.widgets.account');
  const locale = useLocale();
  const { limits } = data;
  const money = (value: number) => formatMoney(value, data.currency, locale);
  const usd = (value: number) => formatMoney(value, 'USD', locale, { digits: 0 });
  const pnlTone = data.dayPnlUsd > 0 ? 'positive' : data.dayPnlUsd < 0 ? 'attention' : 'default';
  const reason = limits.halted
    ? t('haltedOwner')
    : data.brokerTradingBlocked
      ? t('haltedBroker')
      : t('haltedStatus', { status: data.status });

  const dayLoss = usage(-data.dayPnlUsd, limits.dailyLossLimitUsd);
  const orders = usage(data.ordersToday, limits.maxOrdersPerDay);
  const open = positions ? usage(positions.length, limits.maxOpenPositions) : null;
  const largest = positions
    ? Math.max(0, ...positions.map((position) => Math.abs(position.qty * position.currentPrice)))
    : null;
  const largestUsage = largest == null ? null : usage(largest, limits.maxPositionValueUsd);

  const rows: {
    key: string;
    label: string;
    value: string;
    meter: ReturnType<typeof usage> | null;
  }[] = [
    {
      key: 'dayLoss',
      label: t('limits.dayLoss'),
      value: t('limits.of', {
        used: usd(Math.max(0, -data.dayPnlUsd)),
        limit: usd(limits.dailyLossLimitUsd),
      }),
      meter: dayLoss,
    },
    {
      key: 'orders',
      label: t('limits.orders'),
      value: t('limits.of', {
        used: formatCount(data.ordersToday, locale),
        limit: formatCount(limits.maxOrdersPerDay, locale),
      }),
      meter: orders,
    },
    {
      key: 'open',
      label: t('limits.open'),
      value: open
        ? t('limits.of', {
            used: formatCount(positions!.length, locale),
            limit: formatCount(limits.maxOpenPositions, locale),
          })
        : t('limits.max', { limit: formatCount(limits.maxOpenPositions, locale) }),
      meter: open,
    },
    {
      key: 'largest',
      label: t('limits.largest'),
      value:
        largest == null
          ? t('limits.max', { limit: usd(limits.maxPositionValueUsd) })
          : t('limits.of', { used: usd(largest), limit: usd(limits.maxPositionValueUsd) }),
      meter: largestUsage,
    },
    {
      key: 'order',
      label: t('limits.order'),
      value: t('limits.max', { limit: usd(limits.maxOrderValueUsd) }),
      meter: null,
    },
    {
      key: 'risk',
      label: t('limits.risk'),
      value: t('limits.max', { limit: usd(limits.maxRiskPerTradeUsd) }),
      meter: null,
    },
  ];

  return (
    <Stack gap={4}>
      {data.tradingHalted ? (
        <Notice tone="danger" icon={<OctagonAlert />} title={t('haltedTitle')}>
          {reason} {t('haltedHint')}
        </Notice>
      ) : (
        <Inline gap={2} wrap>
          <Pill tone="success" icon={<CircleCheck size={12} />}>
            {t('active')}
          </Pill>
          <Pill tone="accent">{t('paper')}</Pill>
        </Inline>
      )}
      {data.missingLimits.length > 0 && (
        <Notice tone="warning" icon={<TriangleAlert />} title={t('missingTitle')}>
          {t('missingText', {
            names: data.missingLimits
              .map((key) => (isLimitKey(key) ? t(`missing.${key}`) : key))
              .join(', '),
          })}
        </Notice>
      )}

      <Grid min="fit" gap={3}>
        <Tile compact label={t('equity')} value={money(data.equity)} note={t('equityNote')} />
        <Tile compact label={t('cash')} value={money(data.cash)} />
        <Tile compact label={t('buyingPower')} value={money(data.buyingPower)} />
        <Tile
          compact
          label={t('dayPnl')}
          value={formatMoney(data.dayPnlUsd, data.currency, locale, { sign: true })}
          tone={pnlTone}
          note={
            data.dayPnlPct == null
              ? t('dayPnlNone')
              : t('dayPnlNote', { percent: formatPercent(data.dayPnlPct, locale, { sign: true }) })
          }
        />
      </Grid>

      <Stack gap={3}>
        <Text as="h4" weight="semibold">
          {t('limitsTitle')}
        </Text>
        <Grid min="card" gap={4}>
          {rows.map((row) => (
            <Stack key={row.key} gap={1}>
              <Inline justify="between" gap={3}>
                <Text tone="muted">{row.label}</Text>
                <Text tabular tone={row.meter?.reached ? 'danger' : 'default'}>
                  {row.value}
                </Text>
              </Inline>
              {row.meter && <BudgetBar budget={row.meter} label={row.label} />}
            </Stack>
          ))}
        </Grid>
        <Text size="xs" tone="faint">
          {limits.allowedSymbols.length > 0
            ? t('symbols', { symbols: limits.allowedSymbols.join(', ') })
            : t('symbolsAll')}
          {' · '}
          {limits.allowCrypto ? t('cryptoOn') : t('cryptoOff')}
        </Text>
      </Stack>
    </Stack>
  );
}
