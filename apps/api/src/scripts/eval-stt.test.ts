import { describe, expect, it } from 'bun:test';
import { scoreWords, termHits, wordErrors, words } from './eval-stt';

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

  it('treats spoken numbers, clock times, decimals and percentages as digits', () => {
    expect(wordErrors('um sieben Uhr fünfundvierzig', 'um 7.45')).toEqual({ errors: 0, count: 4 });
    expect(wordErrors('um sieben Uhr fünfundvierzig', 'um 7:45 Uhr')).toEqual({
      errors: 0,
      count: 4,
    });
    expect(wordErrors('fünfundzwanzig Prozent', '25 %')).toEqual({ errors: 0, count: 2 });
    expect(wordErrors('zwei Komma fünf', '2,5')).toEqual({ errors: 0, count: 3 });
    expect(wordErrors('sechzehntausend Samples', '16000 Samples')).toEqual({ errors: 0, count: 2 });
    expect(wordErrors('einhunderttausend Samples', '100.000 Samples')).toEqual({
      errors: 0,
      count: 2,
    });
    expect(wordErrors('am achtundzwanzigsten September', 'am 28. September')).toEqual({
      errors: 0,
      count: 3,
    });
    expect(scoreWords('planet')).toEqual(['planet']);
  });
});
