import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { budgetAlerts, budgetState, leadingBudget } from './budgetAlerts';

const budget = (metric: 'cost' | 'tokens', ratio: number, id = 1): BudgetStatus =>
  ({
    id,
    scope: 'project',
    agentId: null,
    projectId: 12,
    metric,
    period: 'day',
    limit: 10,
    used: ratio * 10,
    remaining: Math.max(0, 10 - ratio * 10),
    ratio,
    periodStart: '2026-09-29T00:00:00.000Z',
    warned: ratio >= 0.8,
    reached: ratio >= 1,
    graceRuns: 0,
    unpricedTokens: 0,
  }) as BudgetStatus;

describe('Budgets: Drossel und harter Stopp', () => {
  test('Zustand: unter 80 % ok, ab 80 % gedrosselt, verbraucht gestoppt', () => {
    assert.equal(budgetState(null), 'ok');
    assert.equal(budgetState(budget('cost', 0.5)), 'ok');
    assert.equal(budgetState(budget('cost', 0.8)), 'throttled');
    assert.equal(budgetState(budget('cost', 1.2)), 'stopped');
  });

  test('das maßgebliche Budget: ein verbrauchtes vor dem vollsten', () => {
    const lead = leadingBudget([budget('cost', 0.95, 1), budget('tokens', 1, 2)]);
    assert.equal(lead!.id, 2);
    assert.equal(leadingBudget([]), null);
  });

  test('Hinweise: gestoppte zuerst, dann nach Füllstand, nur was bremst', () => {
    const alerts = budgetAlerts([
      { scope: 'project', id: 12, name: 'Trading', projectKey: 'TRADE', budgets: [budget('cost', 0.9)] },
      { scope: 'agent', id: 5, name: 'Coder VOL', budgets: [budget('tokens', 1.1), budget('cost', 0.1)] },
      { scope: 'department', id: 2, name: 'Volition', budgets: undefined },
    ]);
    assert.deepEqual(
      alerts.map((alert) => [alert.key, alert.state]),
      [
        ['budget:agent:5:tokens:day', 'stopped'],
        ['budget:project:12:cost:day', 'throttled'],
      ],
    );
  });
});
