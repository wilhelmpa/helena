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

test('background fairness and monitoring have validated defaults and boundaries', () => {
  expect(normalizeHalogenPriority({})).toMatchObject({
    minBackgroundSlots: 1,
    maxBackgroundWaitMs: 45_000,
    waitTimeSampleSize: 128,
  });
  const bounds = {
    minBackgroundSlots: [1, 3],
    maxBackgroundWaitMs: [1_000, 120_000],
    waitTimeSampleSize: [1, 4_096],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    for (const value of [min!, max!])
      expect(
        normalizeHalogenPriority({ [key]: value, maxBackground: 3 })[key as keyof typeof bounds],
      ).toBe(value);
    for (const value of [min! - 1, max! + 1, min! + 0.5, Infinity, String(min), null])
      expect(normalizeHalogenPriority({ [key]: value })[key as keyof typeof bounds]).toBe(
        normalizeHalogenPriority({})[key as keyof typeof bounds],
      );
  }
});

test('background minimum fits both its class cap and the interactive reservation', () => {
  expect(
    normalizeHalogenPriority({ minBackgroundSlots: 3, maxBackground: 1 }).minBackgroundSlots,
  ).toBe(1);
  expect(
    normalizeHalogenPriority({ minBackgroundSlots: 3, reservedInteractive: 3 }).minBackgroundSlots,
  ).toBe(1);
  expect(
    normalizeHalogenPriority({ minBackgroundSlots: 3, maxConcurrent: 2 }).minBackgroundSlots,
  ).toBe(1);
});
