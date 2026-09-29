import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentChipLabel, agentDisplayName } from './agentChip';

const words = {
  local: (name: string) => `${name} (lokal)`,
  fallback: (name: string) => `Rückfall: ${name}`,
  standard: 'Agenten-Standard',
};
const home = { name: 'Home', agentRole: 'home' as const };

describe('agent chip', () => {
  it('names the Home agent Ava and the local Halogen model Flash', () => {
    assert.equal(
      agentChipLabel(home, 'helena-halogen/halogen-qwen3.8-flash-next', null, words).label,
      'Ava · Flash (lokal)',
    );
  });

  it('adds the model that really answered after a fallback', () => {
    assert.equal(
      agentChipLabel(home, 'helena-halogen/halogen-qwen3.8-flash-next', 'gpt-6-luna', words).label,
      'Ava · Flash (lokal) · Rückfall: GPT-6 Luna',
    );
  });

  it('keeps other agents by name and falls back to the agent default', () => {
    const coordinator = { name: 'Koordinator TRADE', agentRole: 'agent' as const };
    assert.equal(agentDisplayName(coordinator), 'Koordinator TRADE');
    assert.equal(
      agentChipLabel(coordinator, null, null, words).label,
      'Koordinator TRADE · Agenten-Standard',
    );
    assert.equal(
      agentChipLabel(coordinator, 'claude-opus-5-5', 'claude-opus-5-5', words).label,
      'Koordinator TRADE · Opus 5.5',
    );
  });
});
