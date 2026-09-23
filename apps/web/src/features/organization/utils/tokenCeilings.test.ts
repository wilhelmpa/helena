import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseCeiling, usagePercent } from './tokenCeilings';

describe('parseCeiling', () => {
  test('reads an empty field as no ceiling', () => {
    assert.equal(parseCeiling(''), null);
    assert.equal(parseCeiling('   '), null);
  });

  test('takes a whole number of at least one', () => {
    assert.equal(parseCeiling('1'), 1);
    assert.equal(parseCeiling(' 250000 '), 250_000);
    assert.equal(parseCeiling('1000000000000'), 1_000_000_000_000);
  });

  test('refuses what the API would refuse', () => {
    for (const text of ['0', '-5', '1.5', '1e6', '10k', '1000000000001'])
      assert.equal(parseCeiling(text), undefined, text);
  });
});

describe('usagePercent', () => {
  test('has no share without a ceiling', () => {
    assert.equal(usagePercent(500, null), null);
  });

  test('rounds down and stops at 100', () => {
    assert.equal(usagePercent(0, 1000), 0);
    assert.equal(usagePercent(799, 1000), 79);
    assert.equal(usagePercent(1000, 1000), 100);
    assert.equal(usagePercent(5000, 1000), 100);
  });
});
