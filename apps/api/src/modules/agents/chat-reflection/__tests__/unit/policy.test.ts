import { describe, expect, it } from 'bun:test';
import { normalizeRuntimePolicy } from '../../../core/service';
import { chatReflectionDue, chatReflectionSettings } from '../../policy';

const now = new Date('2026-09-25T20:00:00Z');

describe('chatReflectionSettings', () => {
  it('is on for a learning Hermes agent, with its defaults', () => {
    expect(chatReflectionSettings({ ...normalizeRuntimePolicy({}) })).toEqual({
      enabled: true,
      idleMinutes: 10,
      everyTurns: 20,
    });
  });

  it('is off when the agent does not learn, turned it off, or runs outside Hermes', () => {
    expect(chatReflectionSettings({ ...normalizeRuntimePolicy({}), learning: false }).enabled).toBe(
      false,
    );
    expect(
      chatReflectionSettings({ ...normalizeRuntimePolicy({}), chatReflection: false }).enabled,
    ).toBe(false);
    expect(
      chatReflectionSettings({ ...normalizeRuntimePolicy({}), runtime: 'claude' }).enabled,
    ).toBe(false);
  });

  it('keeps only settings within bounds', () => {
    const policy = normalizeRuntimePolicy({
      chatReflection: false,
      chatReflectionIdleMinutes: 1,
      chatReflectionEveryTurns: 6,
    });
    expect(policy.chatReflection).toBe(false);
    expect(policy.chatReflectionIdleMinutes).toBeUndefined();
    expect(policy.chatReflectionEveryTurns).toBe(6);
  });
});

describe('chatReflectionDue', () => {
  const settings = { enabled: true, idleMinutes: 10, everyTurns: 5 };

  it('waits for two of the person’s messages', () => {
    expect(chatReflectionDue(settings, 1, now)).toBeNull();
  });

  it('is due once the chat has been quiet for the idle time', () => {
    expect(chatReflectionDue(settings, 2, now)).toEqual({
      reason: 'idle',
      at: new Date('2026-09-25T20:10:00Z'),
    });
  });

  it('is due at once after many turns', () => {
    expect(chatReflectionDue(settings, 5, now)).toEqual({ reason: 'turns', at: now });
  });

  it('is never due while off', () => {
    expect(chatReflectionDue({ ...settings, enabled: false }, 50, now)).toBeNull();
  });
});
