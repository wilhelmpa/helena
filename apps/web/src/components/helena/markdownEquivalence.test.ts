import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { equivalentMarkdown } from './markdownEquivalence';

describe('equivalentMarkdown', () => {
  it('ignores blank lines and trailing spaces', () => {
    assert.equal(equivalentMarkdown('## Regeln\n- a\n- b  \n', '## Regeln\n\n- a\n- b\n'), true);
    assert.equal(equivalentMarkdown('a\r\nb', 'a\n\nb'), true);
  });

  it('notices a changed word, marker or order', () => {
    assert.equal(equivalentMarkdown('* a', '- a'), false);
    assert.equal(equivalentMarkdown('a\nb', 'b\na'), false);
    assert.equal(equivalentMarkdown('a <b>', 'a &lt;b&gt;'), false);
    assert.equal(equivalentMarkdown('a', 'a\nb'), false);
  });
});
