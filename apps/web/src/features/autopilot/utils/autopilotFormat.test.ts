import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { changedBudgets, draftFrom, formatBudgetAmount, inputToLimit } from './autopilotFormat';

const budget = (patch: Partial<BudgetStatus>): BudgetStatus => ({
  id: 1,
  scope: 'agent',
  agentId: 1,
  projectId: null,
  metric: 'tokens',
  period: 'day',
  limit: 1000,
  used: 0,
  remaining: 1000,
  ratio: 0,
  periodStart: '2026-09-24T00:00:00.000Z',
  warned: false,
  reached: false,
  graceRuns: 0,
  unpricedTokens: 0,
  ...patch,
});

describe('budget amounts', () => {
  test('read tokens compact, costs in euros and time in hours', () => {
    assert.equal(formatBudgetAmount('tokens', 1_200_000, 'en'), '1.2M');
    assert.equal(formatBudgetAmount('cost', 12.5, 'de').replace(/\s/g, ' '), '12,50 €');
    assert.equal(formatBudgetAmount('time', 5400, 'en'), '1.5 hr');
  });

  test('are typed in their unit, with a comma as the decimal point', () => {
    assert.equal(inputToLimit('time', '1,5'), 5400);
    assert.equal(inputToLimit('cost', '2.25'), 2.25);
    assert.equal(inputToLimit('tokens', '1 000 000'), 1_000_000);
    assert.equal(inputToLimit('tokens', ''), null);
    assert.equal(inputToLimit('tokens', '-3'), undefined);
    assert.equal(inputToLimit('cost', 'abc'), undefined);
  });

  test('name only the budgets a draft changes, and refuse an invalid one', () => {
    const stored = [budget({}), budget({ id: 2, metric: 'time', period: 'month', limit: 7200 })];
    const draft = draftFrom(stored);
    assert.equal(draft['time:month'], '2');
    assert.deepEqual(changedBudgets(stored, draft), []);
    assert.deepEqual(changedBudgets(stored, { ...draft, 'tokens:day': '', 'cost:month': '10' }), [
      { metric: 'tokens', period: 'day', limit: null },
      { metric: 'cost', period: 'month', limit: 10 },
    ]);
    assert.equal(changedBudgets(stored, { ...draft, 'cost:day': '0' }), null);
  });
});
