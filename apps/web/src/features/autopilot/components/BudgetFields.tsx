'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { BUDGET_METRICS, BUDGET_PERIODS } from '@/lib/api/endpoints/autopilot';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  budgetByCell,
  formatBudgetAmount,
  inputToLimit,
  type BudgetCellKey,
} from '../utils/autopilotFormat';

// The budgets of an agent or a project: tokens, euros and hours, each per day and per month,
// with what is used of each in this period. An empty field is no budget.
export default function BudgetFields({
  budgets,
  draft,
  onChange,
  onBlur,
  disabled,
  idPrefix,
}: {
  budgets: BudgetStatus[];
  draft: Record<BudgetCellKey, string>;
  onChange: (key: BudgetCellKey, value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const t = useTranslations('autopilot');
  const byCell = budgetByCell(budgets);
  return (
    <div className="divide-y divide-border/60">
      {BUDGET_METRICS.map((metric) => (
        <div key={metric} className="grid gap-3 p-4 sm:grid-cols-[8rem_1fr_1fr] sm:items-start">
          <div className="pt-1.5 text-sm font-medium">{t(`metric.${metric}`)}</div>
          {BUDGET_PERIODS.map((period) => {
            const key: BudgetCellKey = `${metric}:${period}`;
            const id = `${idPrefix}-${metric}-${period}`;
            const invalid = inputToLimit(metric, draft[key] ?? '') === undefined;
            return (
              <div key={period} className="space-y-1.5">
                <label htmlFor={id} className="text-xs text-muted-foreground">
                  {t(`period.${period}`)}
                </label>
                <div className="relative">
                  <Input
                    id={id}
                    inputMode="decimal"
                    value={draft[key] ?? ''}
                    placeholder={t('noLimit')}
                    disabled={disabled}
                    aria-invalid={invalid || undefined}
                    onChange={(event) => onChange(key, event.target.value)}
                    onBlur={onBlur}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    className="pe-16 tabular-nums"
                  />
                  <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">
                    {t(`metricUnit.${metric}`)}
                  </span>
                </div>
                <BudgetUsage status={byCell.get(key)} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// What is used of a budget in this period, as a bar and in words.
export function BudgetUsage({ status }: { status: BudgetStatus | undefined }) {
  const t = useTranslations('autopilot');
  const locale = useLocale();
  if (!status) return null;
  const used = formatBudgetAmount(status.metric, status.used, locale);
  const limit = formatBudgetAmount(status.metric, status.limit, locale);
  const percent = Math.min(100, Math.round(status.ratio * 100));
  return (
    <div className="space-y-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-border"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t('usedOf', { used, limit })}
      >
        <div
          className={cn(
            'h-full rounded-full',
            status.reached
              ? 'bg-status-danger'
              : status.ratio >= 0.8
                ? 'bg-status-waiting'
                : 'bg-status-success',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
        <span>{t('usedOf', { used, limit })}</span>
        {!status.reached && (
          <span>
            {t('remaining', {
              remaining: formatBudgetAmount(status.metric, status.remaining, locale),
            })}
          </span>
        )}
        {status.reached && <span className="text-status-danger">{t('reached')}</span>}
        {!status.reached && status.ratio >= 0.8 && (
          <span className="text-status-waiting">{t('warned')}</span>
        )}
        {status.graceRuns > 0 && <span>{t('graceRuns', { count: status.graceRuns })}</span>}
        {status.unpricedTokens > 0 && (
          <span>
            {t('unpriced', {
              tokens: formatBudgetAmount('tokens', status.unpricedTokens, locale),
            })}
          </span>
        )}
      </p>
    </div>
  );
}
