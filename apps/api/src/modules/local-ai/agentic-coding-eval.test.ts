import { test, expect } from 'bun:test';
import { evaluateAgenticCoding } from './agentic-coding-eval';

test('coding eval runs all fixture tasks and scores test results', async () => {
  const ids: string[] = [];
  const result = await evaluateAgenticCoding({
    model: 'candidate',
    async chat() {
      throw new Error('unused');
    },
    async embed() {
      throw new Error('unused');
    },
    async runCodingTask(id) {
      ids.push(id);
      return {
        testsPassed: id !== 'ts-clamp',
        validToolCalls: 2,
        toolCalls: 2,
        loops: 0,
        aborted: false,
        durationMs: 100,
        inputTokens: 30,
        outputTokens: 20,
      };
    },
  });
  expect(ids).toHaveLength(12);
  expect(result.score).toBe(11 / 12);
  expect(result.cases.find((item) => item.id === 'ts-clamp')?.passed).toBe(false);
});
