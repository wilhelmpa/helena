import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { soleTeamId } from './homeTeamScope';

describe('single-team Home sections', () => {
  test('reuse the only team without exposing a standalone team route', () => {
    assert.equal(soleTeamId([{ id: 42 }]), 42);
  });

  test('require explicit team management when the scope is ambiguous', () => {
    assert.equal(soleTeamId(undefined), null);
    assert.equal(soleTeamId([]), null);
    assert.equal(soleTeamId([{ id: 1 }, { id: 2 }]), null);
  });
});
