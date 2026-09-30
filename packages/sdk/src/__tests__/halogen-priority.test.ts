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

test('health failure threshold and non-streaming deadline are validated with compatible defaults', () => {
  expect(normalizeHalogenPriority({})).toMatchObject({
    healthProbeMs: 5_000,
    healthTimeoutMs: 10_000,
    healthFailureThreshold: 3,
    nonStreamingTimeoutMs: 900_000,
  });
  for (const value of [1, 3, 20])
    expect(normalizeHalogenPriority({ healthFailureThreshold: value }).healthFailureThreshold).toBe(
      value,
    );
  for (const value of [0, 21, 1.5, Infinity, '3'])
    expect(normalizeHalogenPriority({ healthFailureThreshold: value }).healthFailureThreshold).toBe(
      3,
    );
  for (const value of [60_000, 900_000, 3_600_000])
    expect(normalizeHalogenPriority({ nonStreamingTimeoutMs: value }).nonStreamingTimeoutMs).toBe(
      value,
    );
  for (const value of [59_999, 3_600_001, Infinity, '900000'])
    expect(normalizeHalogenPriority({ nonStreamingTimeoutMs: value }).nonStreamingTimeoutMs).toBe(
      900_000,
    );
});
