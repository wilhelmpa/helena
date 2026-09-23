import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compactTokens, formatElapsed } from './agentUsage';

describe('agent usage formatting', () => {
  test('writes token counts in units of a thousand and a million', () => {
    assert.equal(compactTokens(0), '0');
    assert.equal(compactTokens(999), '999');
    assert.equal(compactTokens(1000), '1.0k');
    assert.equal(compactTokens(12_345), '12.3k');
    assert.equal(compactTokens(2_500_000), '2.5M');
  });

  test('writes a duration in its two largest units', () => {
    assert.equal(formatElapsed(-5), '0s');
    assert.equal(formatElapsed(44_600), '45s');
    assert.equal(formatElapsed(192_000), '3m 12s');
    assert.equal(formatElapsed(7_500_000), '2h 5m');
  });
});
