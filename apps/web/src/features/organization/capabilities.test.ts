import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseCapabilities } from './capabilities';

describe('parseCapabilities', () => {
  test('splits on commas and spaces, lowercases and removes duplicates', () => {
    assert.deepEqual(parseCapabilities('Research, writing  code,research'), [
      'research',
      'writing',
      'code',
    ]);
  });

  test('drops words the API would reject', () => {
    assert.deepEqual(parseCapabilities('-lead, ok-2, a_b, ' + 'x'.repeat(33)), ['ok-2']);
  });

  test('keeps at most 16', () => {
    const many = Array.from({ length: 20 }, (_, index) => `c${index}`).join(',');
    assert.equal(parseCapabilities(many).length, 16);
  });
});
