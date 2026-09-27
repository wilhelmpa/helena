import assert from 'node:assert/strict';
import { it } from 'node:test';
import { editMarkdownSource } from './editMarkdownSource';

it('preserves BOM, comments and mixed existing line endings when multiple spans change', () => {
  const before =
    '\uFEFF---\r\ntitle: First\r\n---\r\n# Guide\n\n<!-- keep -->\r\n[Link](Other.md)\rLast 😀\r\n';
  const input = before
    .replace(/\r\n?/g, '\n')
    .replace('First', 'Second')
    .replace('Last 😀', 'Last 😀!');
  assert.equal(
    editMarkdownSource(before, input),
    before.replace('First', 'Second').replace('Last 😀', 'Last 😀!'),
  );
});

it('maps deleted and inserted source spans without normalizing unchanged lines', () => {
  const before = 'One\r\nRemove\r\nThree\r\n';
  assert.equal(editMarkdownSource(before, 'One\nThree\nAdded\n'), 'One\r\nThree\r\nAdded\n');
  assert.equal(editMarkdownSource(before, 'One\nRemove\nThree\n'), before);
  assert.equal(editMarkdownSource(before, ''), '');
});
