import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { agentTeamPolicyConfiguration, agentTeamPolicyDraft } from './agentTeamPolicy';

describe('agent-team policy form', () => {
  test('reads the stored limits, the budget in minutes', () => {
    assert.deepEqual(
      agentTeamPolicyDraft({
        autonomy: 'done',
        reviewRequired: true,
        maxTurns: 40,
        runBudgetSeconds: 900,
      }),
      { autonomy: 'done', reviewRequired: true, maxTurns: '40', budgetMinutes: '15' },
    );
  });

  test('turns empty fields into no limit and keeps numbers in bounds', () => {
    assert.deepEqual(
      agentTeamPolicyConfiguration({
        autonomy: 'review',
        reviewRequired: true,
        maxTurns: '',
        budgetMinutes: '500',
      }),
      { autonomy: 'review', reviewRequired: true, maxTurns: null, runBudgetSeconds: 7200 },
    );
  });

  test('never sends Done without a review', () => {
    assert.deepEqual(
      agentTeamPolicyConfiguration({
        autonomy: 'done',
        reviewRequired: false,
        maxTurns: '0',
        budgetMinutes: '',
      }),
      { autonomy: 'review', reviewRequired: false, maxTurns: 1, runBudgetSeconds: null },
    );
  });
});
