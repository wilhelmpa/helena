import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentSizeLimits, limitState, memoryArea, withinLimit } from './sizeLimits';

describe('size limits', () => {
  it('turns from ok to a warning above 90 % and to full above the limit', () => {
    assert.equal(limitState(1980, 2200), 'ok');
    assert.equal(limitState(1981, 2200), 'warning');
    assert.equal(limitState(2200, 2200), 'warning');
    assert.equal(limitState(2201, 2200), 'full');
    assert.equal(limitState(50, 0), 'ok');
  });

  it('allows a text up to the limit and anything where there is none', () => {
    assert.equal(withinLimit(2200, 2200), true);
    assert.equal(withinLimit(2201, 2200), false);
    assert.equal(withinLimit(99999, null), true);
  });

  it('reads the limits the server reports and leaves out what is missing or wrong', () => {
    const limits = agentSizeLimits({
      sizeLimits: {
        memory: { used: 1840, limit: 2200 },
        user: { used: 12, limit: 1375, truncated: true },
        soul: { used: 5, limit: 0 },
        dailyNote: 'x',
        instructions: { used: 1, limit: 10 },
      },
    } as never);
    assert.deepEqual(limits, {
      memory: { used: 1840, limit: 2200 },
      user: { used: 12, limit: 1375, truncated: true },
    });
    assert.deepEqual(agentSizeLimits(null), {});
    assert.deepEqual(agentSizeLimits({} as never), {});
  });

  it('reads exactly the areas the API names', () => {
    const limits = agentSizeLimits({
      sizeLimits: {
        dailyNote: { used: 3, limit: 4000 },
        agentInstructions: { used: 1, limit: 20000 },
        projectInstructions: { used: 2, limit: 8000, truncated: true },
        soul: { used: 5, limit: 20000 },
      },
    } as never);
    assert.deepEqual(Object.keys(limits).sort(), [
      'agentInstructions',
      'dailyNote',
      'projectInstructions',
      'soul',
    ]);
  });

  it('maps a memory file to its area', () => {
    assert.equal(memoryArea('MEMORY.md'), 'memory');
    assert.equal(memoryArea('USER.md'), 'user');
  });
});
