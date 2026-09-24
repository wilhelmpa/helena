import { describe, expect, test } from 'bun:test';
import { CedarPolicyEvaluator } from './cedar';
import { ACTION_CATEGORIES, type ActionCategory, type ActionScope } from './categories';
import { AUTOPILOT_LEVELS, type AutopilotLevel } from './levels';

const engine = new CedarPolicyEvaluator();

function decide(
  level: AutopilotLevel,
  category: ActionCategory,
  scope: ActionScope = 'workspace',
  extra: { approved?: boolean; budgetExhausted?: boolean } = {},
) {
  return engine.evaluate({ agentId: 7, projectId: 3, category, scope, level, ...extra });
}

// The whole level × category matrix, per scope: A allow, N needs approval, D deny.
const MATRIX: Record<AutopilotLevel, Record<string, 'A' | 'N' | 'D'>> = {
  0: {
    read: 'A',
    report: 'A',
    write: 'N',
    send: 'N',
    'delete:workspace': 'N',
    'delete:external': 'N',
    pay: 'N',
    publish: 'N',
    'execute:workspace': 'N',
    'execute:external': 'N',
    credentials: 'N',
  },
  1: {
    read: 'A',
    report: 'A',
    write: 'A',
    send: 'N',
    'delete:workspace': 'N',
    'delete:external': 'N',
    pay: 'N',
    publish: 'N',
    'execute:workspace': 'N',
    'execute:external': 'N',
    credentials: 'N',
  },
  2: {
    read: 'A',
    report: 'A',
    write: 'A',
    send: 'N',
    'delete:workspace': 'A',
    'delete:external': 'N',
    pay: 'N',
    publish: 'N',
    'execute:workspace': 'A',
    'execute:external': 'N',
    credentials: 'N',
  },
  3: {
    read: 'A',
    report: 'A',
    write: 'A',
    send: 'A',
    'delete:workspace': 'A',
    'delete:external': 'N',
    pay: 'N',
    publish: 'A',
    'execute:workspace': 'A',
    'execute:external': 'A',
    credentials: 'N',
  },
};

const LETTER = { allow: 'A', 'needs-approval': 'N', deny: 'D' } as const;

type Cell = [AutopilotLevel, ActionCategory, ActionScope, 'A' | 'N' | 'D'];

function cells(): Cell[] {
  return AUTOPILOT_LEVELS.flatMap((level) =>
    Object.entries(MATRIX[level]).map(([cell, expected]): Cell => {
      const [category, scope = 'workspace'] = cell.split(':');
      return [level, category as ActionCategory, scope as ActionScope, expected];
    }),
  );
}

describe('the Autopilot level × category matrix', () => {
  test('covers every category at every level', () => {
    for (const level of AUTOPILOT_LEVELS) {
      const covered = new Set(Object.keys(MATRIX[level]).map((cell) => cell.split(':')[0]));
      expect([...covered].sort()).toEqual([...ACTION_CATEGORIES].sort());
    }
  });

  for (const [level, category, scope, expected] of cells()) {
    test(`level ${level}: ${category} (${scope}) is ${expected}`, () => {
      expect(LETTER[decide(level, category, scope).outcome]).toBe(expected);
    });
  }
});

describe('reasons', () => {
  test('a level that does not permit an action asks for approval without a hard block', () => {
    expect(decide(1, 'send')).toEqual({
      outcome: 'needs-approval',
      reason: 'level-requires-approval',
      policyIds: [],
    });
  });

  test('the hard blocks name themselves at level 3', () => {
    expect(decide(3, 'pay')).toMatchObject({ reason: 'hard-block', policyIds: ['hard-pay'] });
    expect(decide(3, 'credentials')).toMatchObject({ policyIds: ['hard-credentials'] });
    expect(decide(3, 'delete', 'external')).toMatchObject({
      policyIds: ['hard-delete-external'],
    });
  });

  test('an allow says which permit carried it', () => {
    expect(decide(2, 'delete')).toMatchObject({
      outcome: 'allow',
      reason: 'level-allows',
      policyIds: ['level2-workspace'],
    });
    expect(decide(0, 'read')).toMatchObject({ reason: 'always-allowed' });
  });
});

describe('approval', () => {
  test('an approved action goes ahead at every level, hard blocks included', () => {
    for (const level of AUTOPILOT_LEVELS) {
      for (const category of ACTION_CATEGORIES) {
        const decision = decide(level, category, 'external', { approved: true });
        expect(decision.outcome).toBe('allow');
      }
    }
    expect(decide(0, 'pay', 'workspace', { approved: true }).reason).toBe('approved');
  });
});

describe('budgets', () => {
  test('a used-up budget denies everything but reading and reporting, approved or not', () => {
    for (const level of AUTOPILOT_LEVELS) {
      for (const category of ACTION_CATEGORIES) {
        for (const approved of [false, true]) {
          const decision = decide(level, category, 'workspace', {
            budgetExhausted: true,
            approved,
          });
          const expected = category === 'read' || category === 'report' ? 'allow' : 'deny';
          expect(decision.outcome).toBe(expected);
          if (expected === 'deny') expect(decision.reason).toBe('budget-exhausted');
        }
      }
    }
  });
});

describe('extra policies', () => {
  test('a plugin policy is validated and gives its own reason', () => {
    const own = new CedarPolicyEvaluator();
    own.addPolicies('example', [
      {
        id: 'no-publish-in-3',
        text: 'forbid(principal, action == Helena::Action::"publish", resource == Helena::Project::"3") unless { context.approved };',
        reason: 'Project 3 never publishes on its own.',
      },
    ]);
    expect(
      own.evaluate({ agentId: 1, projectId: 3, category: 'publish', scope: 'external', level: 3 }),
    ).toEqual({
      outcome: 'needs-approval',
      reason: 'policy',
      policyIds: ['example/no-publish-in-3'],
      detail: 'Project 3 never publishes on its own.',
    });
    expect(
      own.evaluate({ agentId: 1, projectId: 4, category: 'publish', scope: 'external', level: 3 })
        .outcome,
    ).toBe('allow');
  });

  test('a policy that does not fit the schema is refused', () => {
    const own = new CedarPolicyEvaluator();
    expect(() =>
      own.addPolicies('broken', [
        {
          id: 'typo',
          text: 'permit(principal, action == Helena::Action::"launch", resource);',
          reason: 'x',
        },
      ]),
    ).toThrow(/Cedar policies/);
    expect(
      own.evaluate({ agentId: 1, projectId: 1, category: 'send', scope: 'external', level: 1 })
        .outcome,
    ).toBe('needs-approval');
  });
});
