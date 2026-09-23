import { describe, expect, it } from 'bun:test';
import { searchQuery } from '../../threads/service';

describe('searchQuery', () => {
  it('turns every word into a prefix match', () => {
    expect(searchQuery('Rechnung  März')).toBe("'rechnung':* & 'märz':*");
    expect(searchQuery('anna@verve.ex')).toBe("'anna':* & 'verve.ex':*");
  });

  it('drops the characters that would change the query', () => {
    expect(searchQuery("it's (a) b|c & !d")).toBe("'its':* & 'a':* & 'bc':* & 'd':*");
    expect(searchQuery('  ')).toBeNull();
    expect(searchQuery(':*')).toBeNull();
  });
});
