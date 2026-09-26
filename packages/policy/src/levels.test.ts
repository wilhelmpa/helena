import { describe, expect, it } from 'bun:test';
import { effectiveLevel } from './levels';

describe('Autopilot fallback level', () => {
  it('defaults to level 3 without a project or agent level', () => {
    expect(effectiveLevel({ projectLevel: null, agentLevel: null })).toEqual({
      level: 3,
      source: 'default',
    });
  });

  it('uses the configured instance default only when both explicit levels are absent', () => {
    expect(effectiveLevel({ projectLevel: null, agentLevel: null, defaultLevel: 0 })).toEqual({
      level: 0,
      source: 'default',
    });
    expect(effectiveLevel({ projectLevel: null, agentLevel: 1, defaultLevel: 3 })).toEqual({
      level: 1,
      source: 'agent',
    });
    expect(effectiveLevel({ projectLevel: 2, agentLevel: null, defaultLevel: 3 })).toEqual({
      level: 2,
      source: 'project',
    });
    expect(effectiveLevel({ projectLevel: 2, agentLevel: 0, defaultLevel: 3 })).toEqual({
      level: 0,
      source: 'agent',
    });
  });
});
