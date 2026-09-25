import { describe, expect, it } from 'bun:test';
import { claimedModelCheck, modelCheckOf, sameModel, withStoredFallback } from '../../model-check';

describe('the model a run really ran on', () => {
  it('reads a dated or provider-prefixed id and an alias as the same model', () => {
    expect(sameModel('claude-haiku-4-5', 'claude-haiku-4-5-20251001')).toBe(true);
    expect(sameModel('anthropic/claude-opus-5', 'claude-opus-5')).toBe(true);
    expect(sameModel('opus', 'claude-opus-5')).toBe(true);
    expect(sameModel('gpt-6-luna', 'gpt-5.6-luna')).toBe(false);
    expect(sameModel('opus', 'claude-sonnet-5')).toBe(false);
  });

  it("takes the runtime's default for an agent that names no model, and names a mismatch", () => {
    const check = modelCheckOf({
      requested: { model: null, reasoning: 'low' },
      defaults: { model: 'gpt-5.6-luna', provider: 'openai-codex', reasoning: 'medium' },
      used: { model: 'gpt-5.6-luna', reasoning: 'none', provider: 'openai-codex' },
    });
    expect(check).toEqual({
      configured: { model: 'gpt-5.6-luna', reasoning: 'low', source: 'default' },
      used: { model: 'gpt-5.6-luna', reasoning: 'none', provider: 'openai-codex' },
      mismatch: ['reasoning'],
    });
  });

  it("names the run's own model as its source, and cannot judge what was not reported", () => {
    expect(
      modelCheckOf(
        {
          requested: { model: 'gpt-6-sol', reasoning: null },
          defaults: null,
          used: { model: 'gpt-6-luna', reasoning: null, provider: null },
        },
        'gpt-6-sol',
      ),
    ).toMatchObject({ configured: { source: 'run' }, mismatch: ['model'] });
    expect(
      modelCheckOf({ requested: { model: 'x', reasoning: 'high' }, defaults: null, used: null }),
    ).toMatchObject({ configured: { model: 'x', source: 'agent' }, used: null, mismatch: [] });
    expect(modelCheckOf(undefined)).toBeNull();
  });

  it('reads a local model that the configured one replaced as a fallback, not a mismatch', () => {
    const local = 'helena-local/Qwen3.6-35B-A3B-MTP-GGUF';
    // Hermes moved to its fallback during the run.
    const failed = modelCheckOf({
      requested: { model: local, reasoning: null, provider: 'helena-local' },
      defaults: null,
      used: { model: 'gpt-6-luna', reasoning: 'low', provider: 'openai-codex' },
    });
    expect(failed).toMatchObject({ mismatch: [], fallback: { from: local, reason: 'failed' } });
    // The local model answered: nothing to note.
    expect(
      modelCheckOf({
        requested: { model: local, reasoning: null, provider: 'helena-local' },
        defaults: null,
        used: {
          model: 'Qwen3.6-35B-A3B-MTP-GGUF',
          reasoning: null,
          provider: 'custom:helena-local',
        },
      }),
    ).toEqual({
      configured: { model: local, reasoning: null, source: 'agent' },
      used: { model: 'Qwen3.6-35B-A3B-MTP-GGUF', reasoning: null, provider: 'custom:helena-local' },
      mismatch: [],
    });
    // The claim already chose the configured model (the server did not answer): the report
    // keeps that reason.
    const claimed = claimedModelCheck('gpt-6-luna', 'low', 'agent', {
      from: local,
      reason: 'down',
    });
    const reported = modelCheckOf({
      requested: { model: 'gpt-6-luna', reasoning: 'low' },
      defaults: null,
      used: { model: 'gpt-6-luna', reasoning: 'low', provider: 'openai-codex' },
    });
    expect(withStoredFallback(reported, claimed)).toMatchObject({
      mismatch: [],
      fallback: { from: local, reason: 'down' },
    });
    expect(withStoredFallback(reported, null)).toBe(reported);
  });
});
