import { describe, expect, it } from 'bun:test';
import { validDisplayName } from './brand';

describe('display name validation', () => {
  it('accepts names and rejects HTML, controls and oversized values', () => {
    expect(validDisplayName('Helena')).toBe(true);
    expect(validDisplayName('Volition 2')).toBe(true);
    for (const value of ['', ' Atlas', 'Atlas ', '<script>', 'A\nB', 'A{test}', 'A'.repeat(41)]) {
      expect(validDisplayName(value)).toBe(false);
    }
  });
});
