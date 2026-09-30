import { expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { policyBody } from '../../model';

test('policy API accepts fairness boundaries and rejects invalid integers', () => {
  const bounds = {
    minBackgroundSlots: [1, 3],
    maxBackgroundWaitMs: [1_000, 120_000],
    waitTimeSampleSize: [1, 4_096],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    for (const value of [min!, max!])
      expect(Value.Check(policyBody, { halogenPriority: { [key]: value } })).toBe(true);
    for (const value of [min! - 1, max! + 1, min! + 0.5, String(min), null])
      expect(Value.Check(policyBody, { halogenPriority: { [key]: value } })).toBe(false);
  }
  expect(Value.Check(policyBody, { halogenPriority: {} })).toBe(true);
});
