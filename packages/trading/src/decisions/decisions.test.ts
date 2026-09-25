import { describe, expect, test } from 'bun:test';
import { decisionOptionIds, decisionQuestionProblem, type DecisionEvalSet } from '@helena/sdk';
import { TRADING_DECISION_CLASSES, tradingQuestions } from './classes';

// The same checks Helena's own eval sets pass (apps/api decisions evals.test.ts): unique
// case ids, askable questions, and every expected answer one of its question's options.
function checkSet(set: DecisionEvalSet) {
  const ids = new Set<string>();
  for (const entry of set.cases) {
    expect(ids.has(entry.id)).toBe(false);
    ids.add(entry.id);
    expect(entry.context.length).toBeGreaterThan(20);
    for (const [key, question] of Object.entries(entry.questions)) {
      expect(decisionQuestionProblem(question)).toBeNull();
      const expected = entry.expected[key];
      expect(expected).toBeDefined();
      const options = new Set(decisionOptionIds(question));
      for (const answer of Array.isArray(expected) ? expected : [expected!]) {
        expect({ case: entry.id, question: key, answer, known: options.has(answer) }).toEqual({
          case: entry.id,
          question: key,
          answer,
          known: true,
        });
      }
    }
    expect(Object.keys(entry.expected).sort()).toEqual(Object.keys(entry.questions).sort());
  }
  expect(set.minPrecision).toBeGreaterThanOrEqual(0.85);
  expect(set.minCoverage).toBeGreaterThan(0);
}

describe('trading decision classes', () => {
  test('three classes, each with an eval of at least 24 cases', () => {
    expect(TRADING_DECISION_CLASSES.map((entry) => entry.id)).toEqual([
      'helena.trading.news',
      'helena.trading.rules',
      'helena.trading.routing',
    ]);
    for (const entry of TRADING_DECISION_CLASSES) {
      expect(entry.eval?.cases.length).toBeGreaterThanOrEqual(24);
      checkSet(entry.eval!);
    }
  });

  test('both answers of the rule check appear in its eval', () => {
    const rules = TRADING_DECISION_CLASSES[1]!.eval!;
    const answers = rules.cases.map((entry) => entry.expected.meets);
    expect(answers.filter((answer) => answer === 'yes').length).toBeGreaterThanOrEqual(10);
    expect(answers.filter((answer) => answer === 'no').length).toBeGreaterThanOrEqual(10);
  });

  test('every role of the routing is expected at least once', () => {
    const routing = TRADING_DECISION_CLASSES[2]!.eval!;
    const expected = new Set(routing.cases.flatMap((entry) => [entry.expected.role].flat()));
    const roles = decisionOptionIds(routing.cases[0]!.questions.role!);
    for (const role of roles) expect({ role, seen: expected.has(role) }).toEqual({ role, seen: true });
  });

  test('the questions for each kind', () => {
    expect(Object.keys(tradingQuestions('news').questions)).toEqual(['relevance', 'direction', 'event']);
    expect(tradingQuestions('rule', 'Jeder Trade hat einen Stop.').questions.meets!.question).toContain(
      'Jeder Trade hat einen Stop.',
    );
    expect(() => tradingQuestions('rule', ' ')).toThrow();
    expect(tradingQuestions('routing').classId).toBe('helena.trading.routing');
  });
});
