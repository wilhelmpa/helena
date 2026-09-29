import { expect, test } from 'bun:test';
import { DEFAULT_ESCALATION, normalizeEscalation } from '#modules/escalation/rules';
import { failedRunEscalation, failureKind } from '../../escalation';

const settings = normalizeEscalation({ ...DEFAULT_ESCALATION, enabled: true });
const failed = {
  agentId: 7,
  projectId: 3,
  issueId: 11,
  runtime: 'codex',
  agentModel: 'gpt-6-sol',
  model: 'helena-halogen/halogen-qwen3.8-flash-next',
  configuredModel: 'helena-halogen/halogen-qwen3.8-flash-next',
  modelSource: 'local',
  attempts: 1,
  error: 'Tests failed',
};

test('failed local run selects the strong model of its configured runtime', () => {
  expect(failureKind('Tests failed')).toBe('tests-failed');
  expect(failureKind('Reached the resume limit')).toBe('loop');
  expect(failureKind('Timed out')).toBe('timeout');
  expect(failedRunEscalation(settings, failed)).toEqual({
    model: 'gpt-6-sol',
    reason: 'tests-failed',
  });
  expect(
    failedRunEscalation(settings, { ...failed, runtime: 'claude', agentModel: 'claude-opus-5-5' }),
  ).toEqual({ model: 'claude-opus-5-5', reason: 'tests-failed' });
});

test('pins, attempt threshold and runtime prevent unsafe escalation', () => {
  expect(failedRunEscalation(settings, { ...failed, runtime: 'hermes' })).toBeNull();
  expect(
    failedRunEscalation(settings, {
      ...failed,
      modelSource: null,
      model: 'gpt-6-sol',
      configuredModel: 'gpt-6-sol',
    }),
  ).toBeNull();
  const patient = normalizeEscalation({
    ...settings,
    failure: { ...settings.failure, localAttempts: 2 },
  });
  expect(failedRunEscalation(patient, failed)).toBeNull();
  expect(failedRunEscalation(patient, { ...failed, attempts: 2 })).not.toBeNull();
  const pinned = normalizeEscalation({
    ...settings,
    pins: [{ scope: 'agent', id: 7, mode: 'local', model: null }],
  });
  expect(failedRunEscalation(pinned, failed)).toBeNull();
});
