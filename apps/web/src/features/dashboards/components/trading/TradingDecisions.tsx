'use client';

import { Scale } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, Inline, Pill, Stack, Table, Td, Text, Th, Tr } from '@/design-system';
import type { TradingDecisionCount, TradingDecisionsData } from '@/lib/api/endpoints/trading';
import { formatCount } from '../../utils/tradingFormat';

// Who decided what in the period: the trading decision classes, split by the model that
// answered (Jev, a local model, anything else). "Sicher" means the model was sure enough to
// decide; "unsicher" means it was not and the question went on. "Rückfall" counts the answers
// that came from the fallback connection. The vetos are the rule checks that said no.
function Counts({ value }: { value: TradingDecisionCount }) {
  const t = useTranslations('dashboards.trading.widgets.decisions');
  const locale = useLocale();
  if (value.safe === 0 && value.unsure === 0) return <Text tone="faint">–</Text>;
  return (
    <Inline gap={3} wrap>
      <Text tabular tone="success">
        {t('safe', { count: formatCount(value.safe, locale) })}
      </Text>
      <Text tabular tone={value.unsure > 0 ? 'warning' : 'faint'}>
        {t('unsure', { count: formatCount(value.unsure, locale) })}
      </Text>
    </Inline>
  );
}

export default function TradingDecisions({ data }: { data: TradingDecisionsData }) {
  const t = useTranslations('dashboards.trading.widgets.decisions');
  const locale = useLocale();
  const total = data.classes.reduce(
    (sum, entry) =>
      sum +
      entry.jev.safe +
      entry.jev.unsure +
      entry.local.safe +
      entry.local.unsure +
      entry.other.safe +
      entry.other.unsure,
    0,
  );
  if (data.classes.length === 0 || (total === 0 && data.vetos === 0))
    return (
      <EmptyState fill={false} icon={<Scale />}>
        {t('empty')}
      </EmptyState>
    );
  const label = (classId: string) => {
    const key = classId.split('.').at(-1) ?? classId;
    return key === 'news' || key === 'rules' || key === 'routing' ? t(`classes.${key}`) : classId;
  };
  return (
    <Stack gap={3}>
      <Inline gap={2} wrap>
        <Pill tone={data.vetos > 0 ? 'danger' : 'neutral'}>
          {t('vetos', { count: formatCount(data.vetos, locale) })}
        </Pill>
        <Pill tone="neutral">{t('total', { count: formatCount(total, locale) })}</Pill>
      </Inline>
      <Table label={t('title')}>
        <thead>
          <tr>
            <Th>{t('class')}</Th>
            <Th>{t('jev')}</Th>
            <Th>{t('local')}</Th>
            <Th>{t('other')}</Th>
            <Th alignment="end">{t('fallback')}</Th>
          </tr>
        </thead>
        <tbody>
          {data.classes.map((entry) => (
            <Tr key={entry.classId}>
              <Td label={t('class')}>
                <Text weight="medium">{label(entry.classId)}</Text>
              </Td>
              <Td label={t('jev')}>
                <Counts value={entry.jev} />
              </Td>
              <Td label={t('local')}>
                <Counts value={entry.local} />
              </Td>
              <Td label={t('other')}>
                <Counts value={entry.other} />
              </Td>
              <Td label={t('fallback')} alignment="end">
                <Text tabular tone={entry.fallback > 0 ? 'warning' : 'faint'}>
                  {entry.fallback > 0 ? formatCount(entry.fallback, locale) : '–'}
                </Text>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Text size="xs" tone="faint">
        {t('legend')}
      </Text>
    </Stack>
  );
}
