'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import { cn } from '@/lib/utils';
import type { UsageDimension, UsageRow } from '@/lib/api/endpoints/agentRuntime';
import { compactTokens, formatElapsed } from '@/utils/agentUsage';
import { useAgentUsage } from '../services/agentRuntime.service';

const PERIODS = [7, 30, 90] as const;

// The name a grouping is offered under (agentRuntime.usage.grouping).
export type UsageGrouping = 'agent' | 'model' | 'project' | 'day';
const DAY_MS = 86_400_000;

// What agents spent, from Helena's token ledger: tokens (OpenTelemetry GenAI counts, input
// with its cached part) and cost in euro by the model price table, over a period, grouped
// by the chosen dimensions. For one agent (`agentId`) or all agents of a team.
export default function UsageReport({
  teamId,
  agentId,
  groupings,
}: {
  teamId: number;
  agentId?: number;
  // The groupings offered, the first shown first: each a list of dimensions.
  groupings: { id: UsageGrouping; by: UsageDimension[] }[];
}) {
  const t = useTranslations('agentRuntime.usage');
  const format = useFormatter();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [grouping, setGrouping] = useState(groupings[0]!.id);
  const by = groupings.find((entry) => entry.id === grouping)?.by ?? groupings[0]!.by;
  const today = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS);
  const from = new Date(today.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  const report = useAgentUsage(teamId, { from, agentId, by });
  const euro = (value: number | null) =>
    value === null
      ? '—'
      : format.number(value, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

  const control = (active: boolean) =>
    cn(PAGE_CONTROL_CLASS, 'h-7', active && PAGE_CONTROL_ACTIVE_CLASS);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex items-center gap-0.5" aria-label={t('period')}>
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={days === value}
              className={control(days === value)}
              onClick={() => setDays(value)}
            >
              {t('days', { count: value })}
            </button>
          ))}
        </nav>
        {groupings.length > 1 && (
          <nav className="flex items-center gap-0.5" aria-label={t('groupBy')}>
            {groupings.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={grouping === entry.id}
                className={control(grouping === entry.id)}
                onClick={() => setGrouping(entry.id)}
              >
                {t(`grouping.${entry.id}`)}
              </button>
            ))}
          </nav>
        )}
      </div>
      {report.isPending ? (
        <ListSkeleton rows={4} rowClassName="h-9" />
      ) : !report.data || report.data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('input')} value={compactTokens(report.data.total.inputTokens)} />
            <Stat label={t('output')} value={compactTokens(report.data.total.outputTokens)} />
            <Stat label={t('cost')} value={euro(report.data.total.costEur)} />
            <Stat label={t('entries')} value={String(report.data.total.entries)} />
          </div>
          {report.data.unpriced && <p className="text-xs text-muted-foreground">{t('unpriced')}</p>}
          <div className="overflow-x-auto rounded-md bg-card">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/50">
                  {by.map((dimension) => (
                    <th key={dimension} className="px-3 py-2 text-start font-normal">
                      {t(`dimension.${dimension}`)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-end font-normal">{t('input')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('cached')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('output')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('time')}</th>
                  <th className="px-3 py-2 text-end font-normal">{t('cost')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {report.data.rows.map((row, index) => (
                  <tr key={index} className="hover:bg-accent/60">
                    {by.map((dimension) => (
                      <td key={dimension} className="px-3 py-2 whitespace-nowrap">
                        {cell(row, dimension, t)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                      {compactTokens(row.inputTokens)}
                    </td>
                    <td className="px-3 py-2 text-end text-muted-foreground tabular-nums" dir="ltr">
                      {compactTokens(row.cacheReadTokens)}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                      {compactTokens(row.outputTokens)}
                    </td>
                    <td className="px-3 py-2 text-end text-muted-foreground tabular-nums">
                      {row.durationMs ? formatElapsed(row.durationMs) : '—'}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{euro(row.costEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function cell(
  row: UsageRow,
  dimension: UsageDimension,
  t: ReturnType<typeof useTranslations<'agentRuntime.usage'>>,
): string {
  switch (dimension) {
    case 'agent':
      return row.agentName ?? '—';
    case 'model':
      return row.model ?? t('unknownModel');
    case 'project':
      return row.projectKey ?? t('noProject');
    case 'day':
      return row.day ?? '—';
    case 'kind':
      return row.kind ? t(`kind.${row.kind}`) : '—';
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-md font-medium tabular-nums">{value}</p>
    </div>
  );
}
