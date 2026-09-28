import type { BudgetStatus } from '@/lib/api/endpoints/autopilot';

// How much of a budget is used (hub/pc-costs): a thin bar that turns amber from the
// warning on and rose once the budget is reached. `budgets` may hold several (tokens,
// cost, time; day, month) — the fullest one shows.
export function fullestBudget(budgets: BudgetStatus[] | undefined): BudgetStatus | null {
  if (!budgets?.length) return null;
  return budgets.reduce((top, item) => (item.ratio > top.ratio ? item : top));
}

export default function BudgetBar({
  budget,
  label,
  className,
}: {
  budget: BudgetStatus;
  label?: string;
  className?: string;
}) {
  const ratio = Math.max(0, Math.min(1, budget.ratio));
  const tone = budget.reached ? 'reached' : budget.warned ? 'warned' : 'ok';
  return (
    <span
      className={`ds-budget ${className ?? ''}`}
      data-tone={tone}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={label}
      title={label}
    >
      <span className="ds-budget-fill" style={{ width: `${ratio * 100}%` }} />
    </span>
  );
}
