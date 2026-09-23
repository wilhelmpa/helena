import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentRuntimePolicy, AgentRuntimeState } from '@/lib/api/endpoints/agents';
import type { RuntimeAction } from '@/lib/api/endpoints/agentLearning';
import {
  actionOn,
  canActOnLearning,
  learningOf,
  MEMORY_ACTIONS,
  pinnedAfter,
  SKILL_ACTIONS,
  waitingCount,
} from './agentLearning';

const policy: AgentRuntimePolicy = {
  reasoningEffort: null,
  toolAllow: [],
  toolDeny: [],
  mcpGrants: [],
  files: [],
};

const action = (patch: Partial<RuntimeAction>): RuntimeAction => ({
  id: 1,
  kind: 'pin-skill',
  target: 'research/web-scrape',
  pinned: true,
  error: null,
  createdAt: '2026-09-23T10:00:00.000Z',
  ...patch,
});

describe('agent learning', () => {
  it('lets an agent learn, keeps the curator off and reflects on complex runs unless the policy says otherwise', () => {
    assert.deepEqual(learningOf(policy), { learning: true, curator: false, reflection: 'complex' });
    assert.deepEqual(
      learningOf({ ...policy, learning: false, curator: true, reflection: 'off' }),
      { learning: false, curator: true, reflection: 'off' },
    );
  });

  it('offers actions only to a runner that carries them out', () => {
    const state = { capabilities: ['model'] } as AgentRuntimeState;
    assert.equal(canActOnLearning(state), false);
    assert.equal(canActOnLearning({ ...state, capabilities: ['model', 'learning'] }), true);
  });

  it('finds the newest action on a skill or a memory file', () => {
    const actions = [
      action({ id: 1 }),
      action({ id: 2, kind: 'write-memory', target: 'MEMORY.md', pinned: null }),
      action({ id: 3, kind: 'discard-skill', pinned: null, error: 'The skill path is unsafe' }),
    ];
    assert.equal(actionOn(actions, 'research/web-scrape', SKILL_ACTIONS)?.id, 3);
    assert.equal(actionOn(actions, 'MEMORY.md', MEMORY_ACTIONS)?.id, 2);
    assert.equal(actionOn(actions, 'USER.md', MEMORY_ACTIONS), null);
    assert.equal(actionOn(undefined, 'MEMORY.md', MEMORY_ACTIONS), null);
    assert.equal(waitingCount(actions), 2);
  });

  it('shows the pin a waiting action sets, and the reported one otherwise', () => {
    assert.equal(pinnedAfter(false, action({ pinned: true })), true);
    assert.equal(pinnedAfter(true, action({ pinned: false })), false);
    assert.equal(pinnedAfter(false, action({ pinned: true, error: 'failed' })), false);
    assert.equal(pinnedAfter(true, null), true);
  });
});
