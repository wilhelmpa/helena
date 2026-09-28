import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveStatus } from './helenaStatus';

describe('deriveStatus priority', () => {
  it('uses idle as the empty state', () => {
    assert.equal(deriveStatus({}), 'idle');
  });

  const cases = [
    ['done', { chat: 'answered' }],
    ['thinking', { chat: 'streaming', run: 'done' }],
    ['tool', { chat: 'streaming', tool: 'search', run: 'done' }],
    ['waiting', { chat: 'streaming', tool: 'search', awaitingChoice: true }],
    ['listening', { voicePhase: 'hearing', awaitingChoice: true }],
    ['speaking', { voicePhase: 'speaking', awaitingChoice: true }],
    ['throttled', { budget: 'exhausted', voicePhase: 'speaking' }],
    ['error', { chat: 'failed', budget: 'exhausted' }],
    ['offline', { runtimeStatus: 'offline', chat: 'failed' }],
  ] as const;

  for (const [expected, signals] of cases) {
    it(`${expected} wins over lower-priority signals`, () => {
      assert.equal(deriveStatus(signals), expected);
    });
  }

  it('treats transcription as thinking and tool events as tool', () => {
    assert.equal(deriveStatus({ voicePhase: 'transcribing' }), 'thinking');
    assert.equal(deriveStatus({ run: 'running', tool: true }), 'tool');
  });
});
