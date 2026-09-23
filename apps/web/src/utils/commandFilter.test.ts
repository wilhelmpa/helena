import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ISSUE_PREFIX, KNOWLEDGE_PREFIX, substringFilter } from './commandFilter';

describe('substringFilter', () => {
  it('keeps server results visible in their order, issues before knowledge', () => {
    const scores = [
      substringFilter(`${ISSUE_PREFIX}0`, 'x'),
      substringFilter(`${ISSUE_PREFIX}1`, 'x'),
      substringFilter(`${KNOWLEDGE_PREFIX}0`, 'x'),
      substringFilter(`${KNOWLEDGE_PREFIX}1`, 'x'),
    ];
    assert.ok(scores.every((score) => score > 0));
    assert.deepEqual(
      [...scores].sort((a, b) => b - a),
      scores,
    );
  });

  it('matches commands by substring', () => {
    assert.ok(substringFilter('New issue', 'iss') > 0);
    assert.equal(substringFilter('New issue', 'xyz'), 0);
  });
});
