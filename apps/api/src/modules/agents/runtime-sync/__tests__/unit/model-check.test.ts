import { describe, expect, it } from 'bun:test';
import { modelCheckOf, sameModel } from '../../model-check';

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
});
