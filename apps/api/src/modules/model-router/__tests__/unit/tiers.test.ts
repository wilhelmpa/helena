import { describe, expect, it } from 'bun:test';
import { chooseModel, namedTier, thinkingFor, tieredModels, type RouterModel } from '../../tiers';

const claude: RouterModel[] = [
  { id: 'claude-haiku-4-6', provider: 'anthropic', inputPrice: 0.9 },
  { id: 'claude-sonnet-5', provider: 'anthropic', inputPrice: 2.7 },
  { id: 'claude-opus-5-5', provider: 'anthropic', inputPrice: 13.5 },
  { id: 'claude-fable-1', provider: 'anthropic', inputPrice: 45 },
];
const openai: RouterModel[] = [
  { id: 'gpt-6-luna', provider: 'openai', inputPrice: 1 },
  { id: 'gpt-6-sol', provider: 'openai', inputPrice: 5 },
  { id: 'gpt-5.6-luna', provider: 'openai', inputPrice: null },
  { id: 'claude-haiku-4-6', provider: 'anthropic', inputPrice: 0.9 },
];

describe('model router tiers', () => {
  it('knows the Claude family and the light suffixes by name', () => {
    expect(namedTier('claude-opus-5-5')).toBe('strong');
    expect(namedTier('haiku')).toBe('light');
    expect(namedTier('gpt-6-mini')).toBe('light');
    expect(namedTier('gpt-6-sol')).toBeNull();
  });

  it('ranks unknown names by price from the cheapest, within the provider', () => {
    const tiers = tieredModels(openai[1]!, openai);
    expect(tiers.map((m) => [m.id, m.tier])).toEqual([
      ['gpt-6-sol', 'standard'],
      ['gpt-6-luna', 'light'],
    ]);
  });

  it('moves light work down, keeps harder work, never goes above the configured model', () => {
    const opus = claude[2]!;
    expect(chooseModel(opus, claude, 'light', false).model.id).toBe('claude-haiku-4-6');
    expect(chooseModel(opus, claude, 'standard', false).model.id).toBe('claude-sonnet-5');
    expect(chooseModel(opus, claude, 'strong', false)).toMatchObject({
      model: { id: 'claude-opus-5-5' },
      reason: 'same_tier',
    });
    expect(chooseModel(opus, claude, 'strongest', false).model.id).toBe('claude-opus-5-5');
  });

  it('goes one tier up only where the owner allowed it', () => {
    const sonnet = claude[1]!;
    expect(chooseModel(sonnet, claude, 'strongest', true)).toMatchObject({
      model: { id: 'claude-sonnet-5' },
      reason: 'same_tier',
    });
    expect(chooseModel(sonnet, claude, 'strong', true)).toMatchObject({
      model: { id: 'claude-opus-5-5' },
      reason: 'upgrade',
    });
  });

  it('with two models only light requests move to the cheaper one', () => {
    const sol = openai[1]!;
    expect(chooseModel(sol, openai, 'light', false).model.id).toBe('gpt-6-luna');
    expect(chooseModel(sol, openai, 'standard', false).model.id).toBe('gpt-6-sol');
  });

  it('keeps the reasoning level where the model has it', () => {
    const model: RouterModel = {
      id: 'x',
      inputPrice: 1,
      thinkingLevels: ['low', 'medium'],
      thinkingDefault: 'medium',
    };
    expect(thinkingFor(model, 'low')).toBe('low');
    expect(thinkingFor(model, 'xhigh')).toBe('medium');
  });
});
