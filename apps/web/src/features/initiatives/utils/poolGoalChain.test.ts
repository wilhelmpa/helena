import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectGoalContext } from '@/lib/api/endpoints/projectGoals';
import { poolGoalChain } from './poolGoalChain';

const context = {
  goals: [
    {
      id: 4,
      title: 'Paper-Trading profitabel',
      description: '',
      status: 'active',
      targetDate: null,
      parentGoalId: 1,
      path: ['Helena veröffentlichen'],
      scope: 'project',
      progress: null,
    },
  ],
  links: [{ initiativeId: 7, goalId: 4 }],
} satisfies ProjectGoalContext;

describe('poolGoalChain', () => {
  it('reads the ladder of the Helena goal a project goal serves', () => {
    assert.deepEqual(poolGoalChain(context, 7), {
      goalId: 4,
      steps: ['Helena veröffentlichen', 'Paper-Trading profitabel'],
    });
  });

  it('is null for a project goal that serves none', () => {
    assert.equal(poolGoalChain(context, 8), null);
    assert.equal(poolGoalChain(undefined, 7), null);
  });
});
