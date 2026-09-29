import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readableText } from './readableText';

describe('readableText', () => {
  it('shows the escaped line breaks of a one-line text as real ones', () => {
    assert.equal(readableText('## Ziel\\n\\n- eins\\n- zwei'), '## Ziel\n\n- eins\n- zwei');
  });

  it('leaves a text with real breaks or without escaped ones alone', () => {
    assert.equal(readableText('C:\\new\nx'), 'C:\\new\nx');
    assert.equal(readableText('plain'), 'plain');
  });
});
