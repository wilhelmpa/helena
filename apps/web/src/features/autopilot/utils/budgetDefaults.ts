import type { DefaultBudget } from '@/lib/api/endpoints/projects';
import {
  BUDGET_METRICS,
  BUDGET_PERIODS,
  type BudgetInput,
  type BudgetStatus,
} from '@/lib/api/endpoints/autopilot';

type Cell = { metric: BudgetInput['metric']; period: BudgetInput['period']; limit: number };

const key = (cell: Pick<Cell, 'metric' | 'period'>) => `${cell.metric}:${cell.period}`;

// Whether a project's budgets are Helena's default for projects (Vorgaben für Projekte):
// the same limits in the same cells, nothing more, nothing less.
export function budgetsMatchDefaults(
  budgets: Pick<BudgetStatus, 'metric' | 'period' | 'limit'>[],
  defaults: DefaultBudget[],
): boolean {
  if (budgets.length !== defaults.length) return false;
  const wanted = new Map(defaults.map((cell) => [key(cell), cell.limit]));
  return budgets.every((cell) => wanted.get(key(cell)) === cell.limit);
}

// The change that puts a project back on the default: every cell to the default's limit,
// or removed where the default has none.
export function budgetsFromDefaults(defaults: DefaultBudget[]): BudgetInput[] {
  const wanted = new Map(defaults.map((cell) => [key(cell), cell.limit]));
  return BUDGET_METRICS.flatMap((metric) =>
    BUDGET_PERIODS.map((period) => ({
      metric,
      period,
      limit: wanted.get(`${metric}:${period}`) ?? null,
    })),
  );
}
