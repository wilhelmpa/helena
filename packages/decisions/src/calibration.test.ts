import { describe, expect, it } from 'bun:test';
import {
  calibrateThreshold,
  scoreDecisions,
  splitDecisionCases,
  type CalibrationRow,
} from './calibration';

const row = (id: string, confidence: number, correct = true): CalibrationRow => ({
  class: 'test',
  case: id,
  question: 'q',
  expected: ['yes'],
  choice: correct ? 'yes' : 'no',
  confidence,
});

describe('decision calibration', () => {
  it('keeps cases disjoint and balanced independently of input order and repeated answers', () => {
    const ids = ['e', 'a', 'd', 'b', 'c', 'a'];
    const split = splitDecisionCases(ids);
    expect(splitDecisionCases([...ids].reverse())).toEqual(split);
    expect(split.tuning).toHaveLength(3);
    expect(split.check).toHaveLength(2);
    expect(split.tuning.filter((id) => split.check.includes(id))).toEqual([]);
    expect([...split.tuning, ...split.check].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(splitDecisionCases(['precheck.a', 'a', 'b'])).toEqual(
      splitDecisionCases(['b', 'a', 'precheck.a']),
    );
  });

  it('keeps the routine copies in the heartbeat set on the same side', () => {
    const routine = Array.from(
      { length: 30 },
      (_, i) => `routine-gate.${String(i).padStart(2, '0')}`,
    );
    const standalone = Array.from(
      { length: 30 },
      (_, i) => `heartbeat-precheck.${String(i).padStart(2, '0')}`,
    );
    const original = splitDecisionCases(routine);
    const copied = splitDecisionCases([...standalone, ...routine.map((id) => `precheck.${id}`)]);
    expect(
      copied.tuning.filter((id) => id.startsWith('precheck.')).map((id) => id.slice(9)),
    ).toEqual(original.tuning);
  });

  it('maximizes coverage at millesimal thresholds above incorrect answers', () => {
    const tuning = [row('a', 0.7), row('b', 0.6, false), row('c', 0.95), row('a', 0.61, false)];
    expect(calibrateThreshold(tuning)).toBe(0.611);
    expect(scoreDecisions(tuning, 0.7)).toMatchObject({ accepted: 2, precision: 1, coverage: 0.5 });
  });

  it('retains a predefined floor for unchanged questions with known baseline errors', () => {
    const tuning = [row('a', 0.7), row('c', 0.99)];
    expect(calibrateThreshold(tuning, 0.95)).toBe(0.95);
    expect(scoreDecisions(tuning, 0.95).coverage).toBe(0.5);
  });

  it('abstains when an incorrect answer has confidence one', () => {
    expect(calibrateThreshold([row('a', 1, false), row('b', 1)])).toBeNull();
    expect(scoreDecisions([row('b', 1)], null)).toMatchObject({
      accepted: 0,
      precision: null,
      coverage: 0,
    });
  });

  it('does not use holdout labels to adjust a tuning threshold', () => {
    const tuning = [row('a', 0.55), row('c', 0.3, false)];
    const threshold = calibrateThreshold(tuning);
    expect(threshold).toBe(0.301);
    expect(scoreDecisions([row('b', 0.9, false)], threshold).precision).toBe(0);
    expect(calibrateThreshold(tuning)).toBe(threshold);
  });

  it('excludes provider errors and semantic abstentions at any confidence', () => {
    const rows = [
      { ...row('a', 1), error: 'failed' },
      { ...row('b', 1), choice: 'uncertain', expected: ['uncertain'] },
      { ...row('c', 0), choice: null },
      row('d', 0.1),
    ];
    expect(calibrateThreshold(rows)).toBe(0);
    expect(scoreDecisions(rows, 0)).toMatchObject({ accepted: 1, precision: 1, coverage: 0.25 });
  });
});
