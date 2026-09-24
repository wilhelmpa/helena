import { describe, expect, it } from 'bun:test';
import type { DecisionEvalSet } from '@helena/sdk';
import { runDecisionEval } from './eval';

const q = {
  kind: 'choice' as const,
  question: 'Welche Kategorie?',
  options: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
};

const set: DecisionEvalSet = {
  minPrecision: 0.9,
  minCoverage: 0.5,
  cases: [
    { id: 'c1', context: 'eins', questions: { q }, expected: { q: 'a' } },
    { id: 'c2', context: 'zwei', questions: { q }, expected: { q: 'b' } },
    { id: 'c3', context: 'drei', questions: { q }, expected: { q: ['a', 'b'] } },
    { id: 'c4', context: 'vier', questions: { q }, expected: { q: 'a' } },
  ],
};

describe('runDecisionEval', () => {
  it('scores precision above the threshold and coverage', async () => {
    const answers: Record<string, { choice: string; confidence: number }> = {
      eins: { choice: 'a', confidence: 0.9 },
      zwei: { choice: 'b', confidence: 0.8 },
      drei: { choice: 'b', confidence: 0.2 },
      vier: { choice: 'b', confidence: 0.3 },
    };
    const report = await runDecisionEval(set, 0.5, async (context) => ({
      answers: { q: { ...answers[context]!, probabilities: {} } },
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 0,
      model: 'm',
    }));
    expect(report.questions).toBe(4);
    expect(report.answered).toBe(2);
    expect(report.precision).toBe(1);
    expect(report.coverage).toBe(0.5);
    expect(report.accuracy).toBe(0.75);
    expect(report.passed).toBe(true);
    expect(report.failures.map((f) => f.case).sort()).toEqual(['c3', 'c4']);
    expect(report.sweep.find((s) => s.threshold === 0)?.precision).toBe(0.75);
    expect(report.inputTokens).toBe(40);
  });

  it('fails a class whose backend errors', async () => {
    const report = await runDecisionEval(set, 0.5, async () => {
      throw new Error('down');
    });
    expect(report.passed).toBe(false);
    expect(report.errors).toHaveLength(4);
  });
});
