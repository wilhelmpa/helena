import type {
  BudgetInput,
  BudgetMetric,
  BudgetPeriod,
  BudgetStatus,
} from '@/lib/api/endpoints/autopilot';
import { BUDGET_METRICS, BUDGET_PERIODS } from '@/lib/api/endpoints/autopilot';

// How budget amounts read and how they are typed: tokens as a count, costs in euros, working
// time in hours (the API stores seconds).

export function formatBudgetAmount(metric: BudgetMetric, value: number, locale: string): string {
  if (metric === 'cost') {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: value < 100 ? 2 : 0,
    }).format(value);
  }
  if (metric === 'time') {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'hour',
      maximumFractionDigits: value < 36_000 ? 1 : 0,
    }).format(value / 3600);
  }
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

// The text an input starts with for a stored limit.
export function limitToInput(metric: BudgetMetric, limit: number | null | undefined): string {
  if (limit == null) return '';
  if (metric === 'time') return String(Math.round((limit / 3600) * 100) / 100);
  if (metric === 'cost') return String(Math.round(limit * 100) / 100);
  return String(Math.round(limit));
}

// The limit a typed text stands for: null for an empty field (no budget), undefined for text
// that is not a positive number.
export function inputToLimit(metric: BudgetMetric, text: string): number | null | undefined {
  const trimmed = text.trim().replace(/\s/g, '').replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (metric === 'time') return Math.round(value * 3600);
  if (metric === 'tokens') return Math.round(value);
  return value;
}

export type BudgetCellKey = `${BudgetMetric}:${BudgetPeriod}`;

export const BUDGET_CELLS: { metric: BudgetMetric; period: BudgetPeriod; key: BudgetCellKey }[] =
  BUDGET_METRICS.flatMap((metric) =>
    BUDGET_PERIODS.map((period) => ({ metric, period, key: `${metric}:${period}` as const })),
  );

export function budgetByCell(budgets: BudgetStatus[]): Map<BudgetCellKey, BudgetStatus> {
  return new Map(budgets.map((budget) => [`${budget.metric}:${budget.period}` as const, budget]));
}

// The typed text of every cell, from the stored budgets.
export function draftFrom(budgets: BudgetStatus[]): Record<BudgetCellKey, string> {
  const byCell = budgetByCell(budgets);
  return Object.fromEntries(
    BUDGET_CELLS.map(({ metric, key }) => [key, limitToInput(metric, byCell.get(key)?.limit)]),
  ) as Record<BudgetCellKey, string>;
}

// The budgets a draft changes, or null when a field holds no valid limit.
export function changedBudgets(
  budgets: BudgetStatus[],
  draft: Record<BudgetCellKey, string>,
): BudgetInput[] | null {
  const stored = draftFrom(budgets);
  const changes: BudgetInput[] = [];
  for (const { metric, period, key } of BUDGET_CELLS) {
    const limit = inputToLimit(metric, draft[key] ?? '');
    if (limit === undefined) return null;
    if ((draft[key] ?? '').trim() === stored[key]) continue;
    changes.push({ metric, period, limit });
  }
  return changes;
}
