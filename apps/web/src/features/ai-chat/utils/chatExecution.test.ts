import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelCheck } from '@/lib/api/endpoints/agentRuntimeSync';
import { chatExecution } from './chatExecution';

const check = (over: Partial<ModelCheck> & { used?: ModelCheck['used'] }): ModelCheck => ({
  configured: { model: null, reasoning: null, source: 'agent' },
  used: null,
  mismatch: [],
  ...over,
});

describe('chatExecution', () => {
  it('names a local model local, whatever runtime carried it', () => {
    assert.equal(
      chatExecution(
        check({
          used: {
            model: 'Qwen3.6-35B-A3B-MTP-GGUF',
            reasoning: null,
            provider: 'custom:helena-local',
          },
        }),
        'hermes',
      ),
      'local',
    );
    assert.equal(
      chatExecution(
        check({
          used: {
            model: 'halogen-qwen3.8-flash-next',
            reasoning: null,
            provider: 'helena-halogen',
          },
        }),
        'hermes',
      ),
      'local',
    );
    assert.equal(
      chatExecution(
        check({ used: { model: 'helena-local/Qwen3.6', reasoning: null, provider: null } }),
        'claude',
      ),
      'local',
    );
  });

  it('recognises the configured local model when the runtime reports no provider', () => {
    assert.equal(
      chatExecution(
        check({
          configured: {
            model: 'helena-local/Qwen3.6-35B-A3B-GGUF',
            reasoning: null,
            source: 'agent',
          },
          used: { model: 'Qwen3.6-35B-A3B-GGUF', reasoning: null, provider: null },
        }),
        'hermes',
      ),
      'local',
    );
  });

  it('does not call a fallback to the cloud model local', () => {
    assert.equal(
      chatExecution(
        check({
          configured: {
            model: 'helena-local/Qwen3.6-35B-A3B-GGUF',
            reasoning: null,
            source: 'agent',
          },
          used: { model: 'gpt-6-luna', reasoning: null, provider: 'openai-codex' },
          fallback: { from: 'helena-local/Qwen3.6-35B-A3B-GGUF', reason: 'down' },
        }),
        'hermes',
      ),
      'hermes',
    );
  });

  it("falls back to the run's runtime, then the agent's", () => {
    const cloud = { model: 'gpt-6-sol', reasoning: null, provider: 'openai-codex' };
    assert.equal(chatExecution(check({ runtime: 'claude-code', used: cloud }), 'hermes'), 'claude');
    assert.equal(chatExecution(check({ used: cloud }), 'codex'), 'codex');
    assert.equal(chatExecution(check({ used: cloud }), undefined), null);
    assert.equal(chatExecution(null, 'command'), 'command');
  });
});
