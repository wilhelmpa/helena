'use client';

import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, Inline, Pill, Stack, Table, Td, Text, Th, Tr } from '@/design-system';
import type { TradingApprovalData, TradingStrategiesData } from '@/lib/api/endpoints/trading';
import { vaultNotePath } from '@/utils/paths';
import { formatTradingTime } from '../../utils/tradingFormat';
import { ApprovalPill, StrategyStatusPill } from './TradingPills';

// The strategies of the project and whether each version may trade on the paper account:
// the owner's approval is bound to one version and one account, so a changed strategy is
// "not approved" again. Approving happens on the approval card, not here.
export default function TradingStrategies({ data }: { data: TradingStrategiesData }) {
  const t = useTranslations('dashboards.trading.widgets.strategies');
  const locale = useLocale();
  const known = new Set(data.items.map((item) => `${item.id}@${item.version}`));
  // An approval whose strategy note is gone still shows, so it is not lost from view.
  const orphans = data.approvals.filter(
    (approval) => !known.has(`${approval.strategyId}@${approval.version}`),
  );
  const everyApproval = [
    ...new Map(
      [
        ...data.approvals,
        ...data.items.flatMap((item) => (item.approval ? [item.approval] : [])),
      ].map((approval) => [approval.id, approval]),
    ).values(),
  ];
  const open = everyApproval.filter((approval) => approval.status === 'pending').length;
  const granted = everyApproval.filter((approval) => approval.status === 'approved').length;
  if (data.items.length === 0 && orphans.length === 0)
    return (
      <EmptyState fill={false} icon={<FlaskConical />}>
        {t('empty')}
      </EmptyState>
    );
  const dateOf = (approval: TradingApprovalData | null) =>
    !approval
      ? null
      : approval.decidedAt
        ? t('decided', { date: formatTradingTime(approval.decidedAt, locale, 'date') })
        : t('requested', { date: formatTradingTime(approval.createdAt, locale, 'date') });
  return (
    <Stack gap={3}>
      <Inline gap={2} wrap>
        <Pill tone={open > 0 ? 'warning' : 'neutral'}>{t('openApprovals', { count: open })}</Pill>
        <Pill tone={granted > 0 ? 'success' : 'neutral'}>
          {t('grantedApprovals', { count: granted })}
        </Pill>
      </Inline>
      <Table label={t('title')}>
        <thead>
          <tr>
            <Th>{t('strategy')}</Th>
            <Th>{t('version')}</Th>
            <Th>{t('statusLabel')}</Th>
            <Th>{t('approval')}</Th>
            <Th>{t('backtest')}</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <Tr key={item.path}>
              <Td label={t('strategy')}>
                <Link href={vaultNotePath(item.path)}>
                  <Text mono weight="medium">
                    {item.id || item.path}
                  </Text>
                </Link>
              </Td>
              <Td label={t('version')}>
                <Text mono tone="muted">
                  {item.version ? `v${item.version}` : '–'}
                </Text>
              </Td>
              <Td label={t('statusLabel')}>
                <StrategyStatusPill status={item.status} />
              </Td>
              <Td label={t('approval')}>
                <Inline gap={2} wrap>
                  <ApprovalPill status={item.approval?.status} />
                  {dateOf(item.approval) && (
                    <Text size="xs" tone="faint">
                      {dateOf(item.approval)}
                    </Text>
                  )}
                </Inline>
              </Td>
              <Td label={t('backtest')}>
                {item.backtest ? (
                  <Link href={vaultNotePath(item.backtest)}>
                    <Text tone="accent">{t('openBacktest')}</Text>
                  </Link>
                ) : (
                  <Text tone="faint">{t('noBacktest')}</Text>
                )}
              </Td>
            </Tr>
          ))}
          {orphans.map((approval) => (
            <Tr key={`approval-${approval.id}`}>
              <Td label={t('strategy')}>
                <Text mono weight="medium">
                  {approval.strategyId}
                </Text>
              </Td>
              <Td label={t('version')}>
                <Text mono tone="muted">
                  {approval.version ? `v${approval.version}` : '–'}
                </Text>
              </Td>
              <Td label={t('statusLabel')}>
                <Pill tone="neutral">{t('noteMissing')}</Pill>
              </Td>
              <Td label={t('approval')}>
                <Inline gap={2} wrap>
                  <ApprovalPill status={approval.status} />
                  <Text size="xs" tone="faint">
                    {dateOf(approval)}
                  </Text>
                </Inline>
              </Td>
              <Td label={t('backtest')}>
                <Text tone="faint">{t('noBacktest')}</Text>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Stack>
  );
}
