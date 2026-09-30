import { expect, it } from 'bun:test';
import { calibratedDecisionPolicy, jevDecisionPolicy } from './jev-policy';

it('uses a Jev-specific calibration while retaining stricter explicit settings', () => {
  expect(calibratedDecisionPolicy(0.35, 0.8, null)).toEqual({ enabled: true, threshold: 0.35 });
  expect(calibratedDecisionPolicy(0.95, 0.7, 0.8).threshold).toBe(0.95);
  expect(calibratedDecisionPolicy(0.35, 0.8, 0.9).threshold).toBe(0.9);
});

it('cannot reactivate an abstaining class by setting a lower threshold', () => {
  expect(calibratedDecisionPolicy(null, 0.8, 0)).toEqual({ enabled: false, threshold: 0.8 });
});

it('preserves uncalibrated classes and local or Flash backends', () => {
  expect(calibratedDecisionPolicy(undefined, 0.8, null)).toEqual({ enabled: true, threshold: 0.8 });
  expect(jevDecisionPolicy('helena.mail', 'llm-json', 0.7, null)).toEqual({
    enabled: true,
    threshold: 0.7,
  });
  expect(jevDecisionPolicy('plugin.custom', 'typesafe', 0.8, null)).toEqual({
    enabled: true,
    threshold: 0.8,
  });
});

it('rejects classes failing holdout validation without changing their tuning thresholds', () => {
  expect(jevDecisionPolicy('helena.mail', 'typesafe', 0.7, null)).toEqual({
    enabled: false,
    threshold: 0.961,
  });
  expect(jevDecisionPolicy('tasks.triage', 'vercel', 0.85, null)).toEqual({
    enabled: false,
    threshold: 0.461,
  });
  expect(jevDecisionPolicy('routines.precheck', 'typesafe', 0.8, 0)).toEqual({
    enabled: false,
    threshold: 0.141,
  });
  expect(jevDecisionPolicy('helena.routine.gate', 'typesafe', 0.8, null)).toEqual({
    enabled: false,
    threshold: 0,
  });
});

it('keeps the eight validated classes available and respects higher explicit settings', () => {
  expect(jevDecisionPolicy('agents.routing', 'typesafe', 0.85, null)).toEqual({
    enabled: true,
    threshold: 0,
  });
  expect(jevDecisionPolicy('agents.routing', 'typesafe', 0.85, 0.9)).toEqual({
    enabled: true,
    threshold: 0.9,
  });
  expect(jevDecisionPolicy('helena.receipts', 'typesafe', 0.95, 0.7)).toEqual({
    enabled: true,
    threshold: 0.95,
  });
});
