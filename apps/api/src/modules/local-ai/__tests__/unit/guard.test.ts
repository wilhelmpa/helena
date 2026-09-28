import { describe, expect, it } from 'bun:test';
import { evictionDetected, probeDue, probeOutcome, type LocalAiGuard } from '../../guard-state';

const clean: LocalAiGuard = {
  checkedAt: null,
  probeAt: null,
  probeMs: null,
  probeFailures: 0,
  problem: null,
  availableBytes: 1_000_000,
  consumers: [],
};

describe('local AI guard thresholds', () => {
  it('runs the probe at most once per five minutes', () => {
    expect(probeDue(1_000, 300_999)).toBe(false);
    expect(probeDue(1_000, 301_000)).toBe(true);
  });
  it('needs more than 30 seconds of eviction per process', () => {
    const process = { gpu: '0', pid: 12, name: 'qwen', evictedTimeMs: 60_000, evictedMs5m: 30_000 };
    expect(evictionDetected([process])).toBe(false);
    expect(evictionDetected([{ ...process, evictedMs5m: 30_001 }])).toBe(true);
  });

  it('alerts on three consecutive probe timeouts and resets after an answer', () => {
    const one = probeOutcome(clean, 1, 5_000, false, false);
    const two = probeOutcome(one, 2, 5_000, false, false);
    const three = probeOutcome(two, 3, 5_000, false, false);
    expect(two.problem).toBeNull();
    expect(three).toMatchObject({ probeFailures: 3, problem: 'probe' });
    expect(probeOutcome(three, 4, 100, true, false)).toMatchObject({
      probeFailures: 0,
      problem: null,
    });
  });
});
