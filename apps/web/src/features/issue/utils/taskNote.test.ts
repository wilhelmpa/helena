import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { taskNotePath } from './taskNote';

describe('taskNotePath', () => {
  it('names the note after the task in the project Docs', () => {
    assert.equal(
      taskNotePath('VOL', 'VOL-12', 'Ship the release'),
      'Projects/VOL/Docs/VOL-12 Ship the release.md',
    );
  });

  it('drops the characters a file name or a link cannot hold', () => {
    assert.equal(
      taskNotePath('VOL', 'VOL-3', 'a/b: [draft] #1 | "x"?'),
      'Projects/VOL/Docs/VOL-3 a b draft 1 x.md',
    );
  });
});
