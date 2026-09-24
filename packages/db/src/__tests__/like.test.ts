import { describe, expect, it } from 'bun:test';
import { containsPattern, escapeLike } from '../like';

describe('LIKE patterns', () => {
  it('escapes the wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });

  it('wraps the escaped text for a substring match', () => {
    expect(containsPattern('a_b')).toBe('%a\\_b%');
    expect(containsPattern('plain')).toBe('%plain%');
  });
});
