import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveAgentMode } from './agentNetworkMode';

describe('effectiveAgentMode', () => {
  it('follows the project mode when the agent has none', () => {
    assert.equal(effectiveAgentMode(null, 'open'), 'open');
    assert.equal(effectiveAgentMode(null, 'allowlist'), 'allowlist');
    assert.equal(effectiveAgentMode(null, 'blocked'), 'blocked');
  });

  it("uses the agent's own mode over the project's when it has one", () => {
    assert.equal(effectiveAgentMode('open', 'blocked'), 'open');
    assert.equal(effectiveAgentMode('allowlist', 'open'), 'allowlist');
    assert.equal(effectiveAgentMode('blocked', 'open'), 'blocked');
  });

  it('is a no-op when the override matches the project mode', () => {
    assert.equal(effectiveAgentMode('allowlist', 'allowlist'), 'allowlist');
  });
});
