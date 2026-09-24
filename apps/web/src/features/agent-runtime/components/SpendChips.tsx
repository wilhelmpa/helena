'use client';

import { Coins, Cpu, Timer } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SpendRow } from '@/lib/api/endpoints/agentRuntime';
import { compactTokens, formatElapsed } from '@/utils/agentUsage';

// What a run spent, summed over its rows (the run and its reflection, per model): the
// models, the tokens read and written with the cached part, the time and the cost in euro.
export default function SpendChips({ rows }: { rows: SpendRow[] }) {
  const t = useTranslations('agentRuntime.spend');
  const format = useFormatter();
  if (rows.length === 0) return <span className="text-xs text-muted-foreground">{t('none')}</span>;
  const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'reasoningTokens') =>
    rows.reduce((total, row) => total + row[key], 0);
  const duration = rows.reduce((total, row) => total + (row.durationMs ?? 0), 0);
  const priced = rows.filter((row) => row.costEur !== null);
  const cost = priced.reduce((total, row) => total + (row.costEur ?? 0), 0);
  const models = [...new Set(rows.map((row) => row.model).filter(Boolean))] as string[];
  const chip = 'inline-flex items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3.5';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {models.length > 0 && (
        <span className={chip} dir="ltr">
          <Cpu aria-hidden="true" />
          {models.join(', ')}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={chip} dir="ltr">
            {t('tokens', {
              input: compactTokens(sum('inputTokens')),
              output: compactTokens(sum('outputTokens')),
            })}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {t('tokensDetail', {
            input: sum('inputTokens'),
            cached: sum('cacheReadTokens'),
            output: sum('outputTokens'),
            reasoning: sum('reasoningTokens'),
          })}
        </TooltipContent>
      </Tooltip>
      {duration > 0 && (
        <span className={chip}>
          <Timer aria-hidden="true" />
          {formatElapsed(duration)}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={chip}>
            <Coins aria-hidden="true" />
            {priced.length === 0
              ? t('noPrice')
              : format.number(cost, {
                  style: 'currency',
                  currency: 'EUR',
                  maximumFractionDigits: 4,
                })}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {priced.length < rows.length ? t('costPartial') : t('costHint')}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
