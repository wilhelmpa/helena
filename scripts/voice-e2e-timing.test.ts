import { expect, test } from 'bun:test';
import { summarizeVoiceTimings } from './voice-e2e-timing.mjs';
const answer = {
  pauseMs: 300,
  transcribeMs: 1000,
  answerMs: 300,
  voiceMs: 200,
  totalMs: 1800,
  firstSoundMs: 500,
  firstSoundKind: 'bridge',
};
test('requires every expected spoken answer in a run', () => {
  expect(() => summarizeVoiceTimings([answer, answer], 3)).toThrow('2/3');
  expect(() => summarizeVoiceTimings([], 3)).toThrow();
  expect(summarizeVoiceTimings([answer, answer, answer], 3).totalMs).toBe(1800);
});
test('measures the real answer across ten turns, with a strict latency limit', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ ...answer, totalMs: 2500 + i * 100 }));
  expect(summarizeVoiceTimings(turns, 10, 3000).totalMs).toBe(2950);
  expect(() =>
    summarizeVoiceTimings(
      turns.map((t) => ({ ...t, totalMs: 3000 })),
      10,
      3000,
    ),
  ).toThrow();
  expect(() =>
    summarizeVoiceTimings([{ firstSoundMs: 500, firstSoundKind: 'bridge' }], 1, 3000),
  ).toThrow();
});
