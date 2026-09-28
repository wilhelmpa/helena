import { describe, expect, it } from 'bun:test';
import { composeDecisionModel } from '../../decision-model';

describe('decision model connections', () => {
  it('keeps an own System One server usable without a bundled local preset', () => {
    const saved = composeDecisionModel(
      { provider: 'compatible', baseUrl: 'http://127.0.0.1:8791' },
      { readable: {}, secrets: {} },
    );
    expect(saved.readable).toMatchObject({
      provider: 'compatible',
      baseUrl: 'http://127.0.0.1:8791',
      model: 'jev-latest',
      keySource: 'stored',
    });
  });

  it('replaces an unsupported saved key source when the connection is edited', () => {
    const saved = composeDecisionModel(
      { model: 'jev-1.13.0' },
      {
        readable: {
          provider: 'compatible',
          baseUrl: 'https://example.test',
          keySource: 'retired-source',
        },
        secrets: {},
      },
    );
    expect(saved.readable.keySource).toBe('stored');
    expect(saved.readable.model).toBe('jev-1.13.0');
  });
});
