import { expect, test } from 'bun:test';
import { contextFileLimit, effectiveContextLimits, truncateContext } from '../context-limits';

test('exact boundary and one character over', () => {
  expect(truncateContext('x'.repeat(2200), 2200).truncated).toBe(false);
  const cut = truncateContext('x'.repeat(2201), 2200);
  expect(cut.truncated).toBe(true);
  expect(cut.charsBefore).toBe(2201);
  expect(cut.charsAfter).toBeLessThanOrEqual(2200);
  expect(truncateContext('x'.repeat(100), 50).charsAfter).toBeLessThanOrEqual(50);
});

test('model window changes dynamic context file limit for Flash and 27B', () => {
  expect(contextFileLimit(256_000, 20_000)).toBe(61_440);
  expect(contextFileLimit(32_768, 20_000)).toBe(20_000);
  expect(contextFileLimit(131_072, 20_000)).toBe(31_457);
  expect(contextFileLimit(256_000, 20_000, true)).toBe(20_000);
});

test('agent values override the team without resetting unrelated values', () => {
  const limits = effectiveContextLimits({ memory: 3000, soul: 40_000 }, { memory: 1000 });
  expect(limits.memory).toBe(1000);
  expect(limits.soul).toBe(40_000);
  expect(limits.user).toBe(1375);
});
