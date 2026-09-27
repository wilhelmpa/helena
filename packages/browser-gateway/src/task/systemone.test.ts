import { describe, expect, it } from 'bun:test';
import { DirectDecisionClient, validChoice } from './systemone';

describe('System One contract', () => {
  it('preserves provider confidence separately from the selected probability', () => {
    const answer = validChoice(
      { choice: 'yes', probabilities: { yes: 0.99, no: 0.01 }, confidence: 0.97 },
      ['yes', 'no'],
    );
    expect(answer.confidence).toBe(0.97);
    expect(answer.probabilities.yes).toBe(0.99);
  });

  it('accepts zero confidence without replacing it with the selected probability', () => {
    expect(
      validChoice({ choice: 'a', probabilities: { a: 0.5, b: 0.5 }, confidence: 0 }, ['a', 'b'])
        .confidence,
    ).toBe(0);
  });

  it.each(['https://example.test', 'https://example.test/', 'https://example.test/v1/'])(
    'uses one v1 segment when evaluating %s',
    async (baseUrl) => {
      const urls: string[] = [];
      const client = new DirectDecisionClient({
        baseUrl,
        model: 'jev-1.13.0',
        fetchImpl: (async (url, init) => {
          urls.push(String(url));
          expect(JSON.parse(String(init?.body)).model).toBe('jev-1.13.0');
          return Response.json({ model: 'jev-1.13.0', answers: {} });
        }) as typeof fetch,
      });
      await client.decide({ state: {}, questions: {} });
      expect(urls).toEqual(['https://example.test/v1/systemone']);
    },
  );
});
