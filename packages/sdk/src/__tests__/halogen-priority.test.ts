import { expect, test } from 'bun:test';
import { normalizeHalogenPriority } from '../halogen-priority';

test('voice reply has its own validated ceiling', () => {
  expect(normalizeHalogenPriority({}).voiceReplyMaxTokens).toBe(512);
  expect(normalizeHalogenPriority({ voiceReplyMaxTokens: 4_096 }).voiceReplyMaxTokens).toBe(4_096);
  expect(normalizeHalogenPriority({ voiceReplyMaxTokens: 4_097 }).voiceReplyMaxTokens).toBe(512);
  expect(normalizeHalogenPriority({ interactiveMaxTokens: 4_096 }).voiceReplyMaxTokens).toBe(512);
});

test('interactive queue allows five minutes locally and defaults to thirty seconds', () => {
  expect(normalizeHalogenPriority({}).interactiveQueueMs).toBe(30_000);
  for (const value of [100, 30_000, 300_000])
    expect(normalizeHalogenPriority({ interactiveQueueMs: value }).interactiveQueueMs).toBe(value);
  for (const value of [99, 300_001, 100.5, Infinity, '300000'])
    expect(normalizeHalogenPriority({ interactiveQueueMs: value }).interactiveQueueMs).toBe(30_000);
});
