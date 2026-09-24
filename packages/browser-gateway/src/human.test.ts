import { describe, expect, it } from 'bun:test';
import {
  mouseCurve,
  randomBetween,
  scrollSteps,
  stepsFor,
  typingDelayMs,
  preClickPauseMs,
} from './human';

// A fixed PRNG-like sequence for deterministic tests where the exact value matters.
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('randomBetween', () => {
  it('stays within [min, max]', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const value = randomBetween(10, 20, () => r);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });
});

describe('typingDelayMs / preClickPauseMs', () => {
  it('typing delay is within the 40-140ms range design §7 asks for', () => {
    for (const r of [0, 0.5, 1]) {
      const ms = typingDelayMs(() => r);
      expect(ms).toBeGreaterThanOrEqual(40);
      expect(ms).toBeLessThanOrEqual(140);
    }
  });

  it('pre-click pause is a short, non-zero pause', () => {
    const ms = preClickPauseMs(() => 0.5);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  });
});

describe('mouseCurve', () => {
  it('ends exactly at the target point', () => {
    const points = mouseCurve({ x: 0, y: 0 }, { x: 100, y: 50 }, 8, sequence([0.5]));
    const last = points[points.length - 1];
    expect(last.x).toBeCloseTo(100, 5);
    expect(last.y).toBeCloseTo(50, 5);
  });

  it('produces the requested number of intermediate points', () => {
    const points = mouseCurve({ x: 0, y: 0 }, { x: 200, y: 0 }, 12, sequence([0.3]));
    expect(points).toHaveLength(12);
  });

  it('bows away from a straight line for a long move (not a dead-straight drag)', () => {
    const points = mouseCurve({ x: 0, y: 0 }, { x: 300, y: 0 }, 10, sequence([0.9])); // 0.9 >= 0.5 -> deterministic side
    const midpoint = points[Math.floor(points.length / 2) - 1];
    // The straight line from (0,0) to (300,0) has y=0 everywhere; a curved path bows off it.
    expect(Math.abs(midpoint.y)).toBeGreaterThan(1);
  });

  it('a zero-distance move does not produce NaN coordinates', () => {
    const points = mouseCurve({ x: 10, y: 10 }, { x: 10, y: 10 }, 4, sequence([0.5]));
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe('stepsFor', () => {
  it('uses more steps for a longer move, within the clamp', () => {
    const short = stepsFor({ x: 0, y: 0 }, { x: 10, y: 0 });
    const long = stepsFor({ x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(short).toBeGreaterThanOrEqual(4);
    expect(long).toBeLessThanOrEqual(24);
    expect(long).toBeGreaterThan(short);
  });
});

describe('scrollSteps', () => {
  it('splits the total into the requested number of steps that sum back to the total', () => {
    const steps = scrollSteps(1000, 4);
    expect(steps).toHaveLength(4);
    expect(steps.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('handles a total that does not divide evenly', () => {
    const steps = scrollSteps(101, 4);
    expect(steps.reduce((a, b) => a + b, 0)).toBe(101);
  });
});
