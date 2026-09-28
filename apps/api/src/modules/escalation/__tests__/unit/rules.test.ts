import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_ESCALATION,
  escalate,
  normalizeEscalation,
  type EscalationSettings,
} from '../../rules';

// The escalation rules (docs/helena-decisions/halogen.md §8): when a strong model takes over.

const on: EscalationSettings = { ...DEFAULT_ESCALATION, enabled: true };
const work = { agentId: 5, projectId: 2, taskId: 40 };

describe('escalation settings', () => {
  it('are off by default, with every kind of hard work routed to a strong model', () => {
    const settings = normalizeEscalation(undefined);
    expect(settings.enabled).toBe(false);
    expect(settings.kinds.map((entry) => entry.kind)).toEqual([
      'coding',
      'architecture',
      'security',
      'legal',
      'external-text',
    ]);
    expect(settings.uncertainty.threshold).toBe(0.8);
  });

  it('keep what is valid and fill in the rest', () => {
    const settings = normalizeEscalation({
      enabled: true,
      defaultModel: 'claude-opus-5-5',
      kinds: [
        { kind: 'legal', enabled: false, model: null },
        { kind: 'bogus', enabled: true },
      ],
      uncertainty: { threshold: 7 },
      failure: { on: ['loop', 'nonsense'], localAttempts: 9 },
      pins: [
        { scope: 'agent', id: 5, mode: 'local', model: null },
        { scope: 'agent', id: 5, mode: 'strong', model: 'gpt-6-sol' },
        { scope: 'room', id: 1, mode: 'local' },
        { scope: 'task', id: -1, mode: 'local' },
      ],
    });
    expect(settings.defaultModel).toBe('claude-opus-5-5');
    expect(settings.kinds.find((entry) => entry.kind === 'legal')).toEqual({
      kind: 'legal',
      enabled: false,
      model: null,
    });
    expect(settings.kinds).toHaveLength(5);
    expect(settings.uncertainty.threshold).toBe(0.8);
    expect(settings.failure).toMatchObject({ on: ['loop'], localAttempts: 1 });
    // One pin per scope and id; the last one wins.
    expect(settings.pins).toEqual([{ scope: 'agent', id: 5, mode: 'strong', model: 'gpt-6-sol' }]);
  });
});

describe('escalate', () => {
  it('does nothing while off', () => {
    expect(escalate(DEFAULT_ESCALATION, { ...work, kinds: ['security'] })).toEqual({
      model: null,
      reason: 'off',
      detail: null,
    });
  });

  it('sends hard kinds of work to their strong model', () => {
    expect(escalate(on, { ...work, kinds: ['coding'] })).toMatchObject({
      model: 'gpt-6-sol',
      reason: 'kind',
      detail: 'coding',
    });
    expect(escalate(on, { ...work, kinds: ['legal'] }).model).toBe('claude-opus-5-5');
  });

  it('escalates an unsure local answer, and keeps a sure one local', () => {
    expect(escalate(on, { ...work, confidence: 0.55 })).toMatchObject({
      model: 'gpt-6-sol',
      reason: 'uncertain',
      detail: '0.55',
    });
    expect(escalate(on, { ...work, confidence: 0.93 })).toMatchObject({
      model: null,
      reason: 'none',
    });
  });

  it('lets the strong model take over after the local attempts failed', () => {
    expect(escalate(on, { ...work, failure: 'tests-failed', localAttempts: 1 })).toMatchObject({
      model: 'gpt-6-sol',
      reason: 'failed',
      detail: 'tests-failed',
    });
    // An error that is not on the list stays local (the run's own retries handle it).
    expect(escalate(on, { ...work, failure: 'error', localAttempts: 3 }).reason).toBe('none');
    const patient = normalizeEscalation({ ...on, failure: { ...on.failure, localAttempts: 2 } });
    expect(escalate(patient, { ...work, failure: 'loop', localAttempts: 1 }).reason).toBe('none');
    expect(escalate(patient, { ...work, failure: 'loop', localAttempts: 2 }).reason).toBe('failed');
  });

  it('follows the narrowest pin: task over agent over project', () => {
    const pinned = normalizeEscalation({
      ...on,
      pins: [
        { scope: 'project', id: 2, mode: 'strong', model: null },
        { scope: 'agent', id: 5, mode: 'local', model: null },
      ],
    });
    expect(escalate(pinned, { ...work, kinds: ['security'] })).toMatchObject({
      model: null,
      reason: 'pinned-local',
      detail: 'agent',
    });
    const task = normalizeEscalation({
      ...pinned,
      pins: [...pinned.pins, { scope: 'task', id: 40, mode: 'strong', model: 'claude-opus-5-5' }],
    });
    expect(escalate(task, work)).toMatchObject({
      model: 'claude-opus-5-5',
      reason: 'pinned-strong',
      detail: 'task',
    });
    expect(escalate(pinned, { ...work, agentId: 9 })).toMatchObject({
      model: 'gpt-6-sol',
      reason: 'pinned-strong',
      detail: 'project',
    });
  });
});
