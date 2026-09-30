import { expect, test } from 'bun:test';
import { normalizeAgentEscalation } from '../../../core/service';
import {
  delegationBrief,
  failureDecision,
  failureKind,
  reviewAccepted,
  reviewBrief,
  weakenedTests,
} from '../../escalation';

const policy = normalizeAgentEscalation({ afterFailures: 2, onResumeLimit: true });
const failed = {
  trigger: 'manual',
  continuedFromRunId: null,
  agentId: 7,
  projectId: 3,
  issueId: 11,
  attempts: 1,
  failures: 1,
  error: 'Tests failed',
};

test('synthetic failures trigger after the configured count and resume limit', () => {
  expect(failureKind('Tests failed')).toBe('tests-failed');
  expect(failureDecision(policy, failed)).toBeNull();
  expect(failureDecision(policy, { ...failed, failures: 2 })).toEqual({
    model: 'gpt-6-sol',
    reason: 'failed-attempts',
    count: 2,
  });
  expect(failureDecision(policy, { ...failed, error: 'Reached the resume limit' })).toEqual({
    model: 'gpt-6-sol',
    reason: 'resume-limit',
    count: 1,
  });
  expect(
    failureDecision(
      { ...policy, onResumeLimit: false },
      { ...failed, error: 'Reached the resume limit' },
    ),
  ).toBeNull();
});

test('one escalation stage prevents recursive delegation', () => {
  expect(failureDecision(policy, { ...failed, trigger: 'escalation', failures: 3 })).toBeNull();
  expect(failureDecision(policy, { ...failed, continuedFromRunId: 9, failures: 3 })).toBeNull();
  expect(failureDecision({ ...policy, maxDepth: 0 }, { ...failed, failures: 3 })).toBeNull();
});

test('synthetic handover returns full task context and review requires independent gates', () => {
  const brief = delegationBrief({
    runId: 8,
    prompt: 'Fix endpoint',
    output: 'Previous output',
    error: 'Tests failed',
    history: [{ prompt: 'First try', output: 'Bad result', error: 'Type error' }],
    reason: 'failed-attempts',
    handover: 'Recheck the endpoint',
  });
  expect(brief).toContain('Fix endpoint');
  expect(brief).toContain('First try');
  expect(brief).toContain('Tests failed');
  expect(brief).toContain('erstelle keinen Commit');
  const review = reviewBrief(8, 9, {
    status: 'success',
    touchedFiles: ['src/api.ts'],
    finalMessage: 'Fixed',
    version: '1',
    durationMs: 1200,
    diff: 'diff --git a/src/api.ts b/src/api.ts',
  });
  expect(review).toContain('src/api.ts');
  expect(review).toContain('geänderte bestehende Tests');
  expect(review).toContain('Projekt-Gates selbst neu');
  expect(review).toContain('commit');
});

test('acceptance requires checked tests, passing gates and a commit', () => {
  const valid = {
    status: 'accepted',
    changedTestsChecked: true,
    gates: [{ command: 'bun test api', passed: true }],
    commit: 'a'.repeat(40),
    message: 'Applied diff',
  };
  expect(reviewAccepted(JSON.stringify(valid))).toEqual({
    commit: 'a'.repeat(40),
    message: 'Applied diff',
  });
  expect(reviewAccepted(JSON.stringify({ ...valid, changedTestsChecked: false }))).toBeNull();
  expect(
    reviewAccepted(
      JSON.stringify({ ...valid, gates: [{ command: 'bun test api', passed: false }] }),
    ),
  ).toBeNull();
  expect(reviewAccepted(JSON.stringify({ ...valid, commit: null }))).toBeNull();
  expect(reviewAccepted(JSON.stringify({ ...valid, status: 'rejected' }))).toBeNull();
});

test('changed tests with removed assertions or skips block acceptance', () => {
  expect(
    weakenedTests(
      'diff --git a/src/x.test.ts b/src/x.test.ts\n-expect(value).toBe(1);\n+test.skip("x", () => {});',
    ),
  ).toEqual(['src/x.test.ts']);
  expect(
    weakenedTests('diff --git a/src/x.test.ts b/src/x.test.ts\n+expect(value).toBe(2);'),
  ).toEqual([]);
  expect(
    weakenedTests(
      'diff --git a/src/x.test.ts b/src/x.test.ts\n-expect(value).toBe(1);\n+expect(value).toBe(2);',
    ),
  ).toEqual([]);
});
