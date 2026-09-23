import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentRuntime, chatAgentState, openWorkByAgent } from './agentPresence';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const seen = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

function agent(overrides: Partial<Parameters<typeof chatAgentState>[0]> = {}) {
  return {
    template: false,
    pausedAt: null,
    lastSeenAt: seen(5),
    runtimeState: { adapter: 'hermes' } as never,
    ...overrides,
  };
}

describe('chatAgentState', () => {
  it('reads a polling runner with nothing open as ready', () => {
    assert.deepEqual(chatAgentState(agent(), undefined, NOW), {
      presence: 'ready',
      label: 'ready',
      runtime: 'hermes',
      selectable: true,
      online: true,
    });
  });

  it('shows open work as running, and a question to the member as waiting', () => {
    assert.equal(chatAgentState(agent(), 'running', NOW).label, 'running');
    assert.equal(chatAgentState(agent(), 'waiting', NOW).presence, 'waiting');
  });

  it('tells a runner that went away from one that never connected', () => {
    assert.equal(chatAgentState(agent({ lastSeenAt: seen(600) }), undefined, NOW).label, 'offline');
    assert.equal(chatAgentState(agent({ lastSeenAt: null }), undefined, NOW).label, 'never');
    // Work queued for an agent whose runner is gone does not make it look busy.
    assert.equal(chatAgentState(agent({ lastSeenAt: seen(600) }), 'running', NOW).label, 'offline');
  });

  it('keeps a paused agent selectable but not online, and a template not selectable', () => {
    const paused = chatAgentState(agent({ pausedAt: seen(10) }), undefined, NOW);
    assert.equal(paused.label, 'paused');
    assert.equal(paused.selectable, true);
    assert.equal(paused.online, false);
    const template = chatAgentState(agent({ template: true }), undefined, NOW);
    assert.equal(template.label, 'template');
    assert.equal(template.selectable, false);
  });
});

describe('agentRuntime', () => {
  it('maps the adapter a runner reported to the runtime code', () => {
    const of = (adapter: string | null) => agentRuntime({ runtimeState: { adapter } as never });
    assert.equal(of('hermes'), 'hermes');
    assert.equal(of('claude-code'), 'claude');
    assert.equal(of('codex'), 'codex');
    assert.equal(of('opencode'), 'external');
    assert.equal(of(null), null);
  });
});

describe('openWorkByAgent', () => {
  it('lets a waiting entry win over a running one of the same agent', () => {
    const work = openWorkByAgent([
      { status: 'streaming', agent: { id: 1, username: 'a', name: 'A' } },
      { status: 'waiting', agent: { id: 1, username: 'a', name: 'A' } },
      { status: 'success', agent: { id: 2, username: 'b', name: 'B' } },
      { status: 'pending', agent: null },
    ]);
    assert.deepEqual([...work], [[1, 'waiting']]);
  });
});
