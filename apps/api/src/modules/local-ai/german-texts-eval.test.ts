import { test, expect } from 'bun:test';
import { evaluateGermanTexts, GERMAN_TEXT_CASES } from './german-texts-eval';

test('German text eval asks ten cases and reports the judge average', async () => {
  let candidateCalls = 0;
  let judgeCalls = 0;
  const result = await evaluateGermanTexts({
    model: 'candidate',
    async chat() {
      candidateCalls++;
      return {
        text: 'Ein deutscher Antworttext.',
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
      };
    },
    async judge() {
      judgeCalls++;
      return {
        text: '{"score": 85, "reason": "accurate"}',
        toolCalls: [],
        inputTokens: 20,
        outputTokens: 10,
        latencyMs: 50,
      };
    },
    async embed() {
      throw new Error('unused');
    },
  });
  expect(GERMAN_TEXT_CASES).toHaveLength(10);
  expect(candidateCalls).toBe(10);
  expect(judgeCalls).toBe(10);
  expect(result.score).toBe(0.85);
  expect(result.cases.every((item) => item.passed)).toBe(true);
});
