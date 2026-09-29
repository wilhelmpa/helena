import type { BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { WARN_RATIO } from './budgetState';

export type BudgetState = 'ok' | 'throttled' | 'stopped';

// What a budget means for the work (Paperclip's budgets, owner 28.09.): used up, the work
// stops (a project holds its runs, an agent pauses) — "gestoppt"; from 80 % on, the
// heartbeats slow down — "gedrosselt"; below that nothing happens.
export function budgetState(budget: Pick<BudgetStatus, 'ratio' | 'reached'> | null): BudgetState {
  if (!budget) return 'ok';
  if (budget.reached) return 'stopped';
  return budget.ratio >= WARN_RATIO ? 'throttled' : 'ok';
}

// The budget of a set that matters most: a used-up one, else the fullest.
export function leadingBudget(budgets: BudgetStatus[] | undefined): BudgetStatus | null {
  if (!budgets?.length) return null;
  return budgets.reduce((top, item) =>
    item.reached !== top.reached
      ? item.reached
        ? item
        : top
      : item.ratio > top.ratio
        ? item
        : top,
  );
}

export interface BudgetHolder {
  scope: 'project' | 'agent' | 'department';
  id: number;
  name: string;
  // The project's key, for its link and tag.
  projectKey?: string;
  budgets: BudgetStatus[] | undefined;
}

export interface BudgetAlert {
  // Stable across reloads: `budget:project:12:cost:day`.
  key: string;
  holder: BudgetHolder;
  budget: BudgetStatus;
  state: Exclude<BudgetState, 'ok'>;
}

// Every budget that stops or slows work now, the stopped ones first, then by how full.
export function budgetAlerts(holders: BudgetHolder[]): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  for (const holder of holders)
    for (const budget of holder.budgets ?? []) {
      const state = budgetState(budget);
      if (state === 'ok') continue;
      alerts.push({
        key: `budget:${holder.scope}:${holder.id}:${budget.metric}:${budget.period}`,
        holder,
        budget,
        state,
      });
    }
  return alerts.sort(
    (a, b) =>
      (a.state === 'stopped' ? 0 : 1) - (b.state === 'stopped' ? 0 : 1) ||
      b.budget.ratio - a.budget.ratio ||
      a.key.localeCompare(b.key),
  );
}
