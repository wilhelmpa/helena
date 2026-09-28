import { describe, expect, it } from 'bun:test';
import { termHits, wordErrors, words } from './eval-stt';

describe('STT evaluation', () => {
  it('counts substitutions, insertions and deletions', () => {
    expect(wordErrors('Helena öffnet TRADE', 'Helena öffnet VERVE')).toEqual({
      errors: 1,
      count: 3,
    });
    expect(wordErrors('Helena öffnet TRADE', 'Helena öffnet')).toEqual({ errors: 1, count: 3 });
    expect(wordErrors('Helena öffnet TRADE', 'Helena öffnet jetzt TRADE')).toEqual({
      errors: 1,
      count: 3,
    });
  });

  it('normalizes German punctuation and counts complete technical terms', () => {
    expect(words('Qwen, fünf Uhr dreißig!')).toEqual(['qwen', 'fünf', 'uhr', 'dreißig']);
    expect(termHits(['Qwen', 'TRADE', 'Jev'], 'Qwen startet TRADE, aber nicht Jeven.')).toBe(2);
  });
});
