import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanFileName, foldersBetween, noteName, parentPath } from './vaultPaths';

describe('vault paths', () => {
  it('splits a note path into folder and name', () => {
    assert.equal(parentPath('Projects/VOL/Docs/Guides/Release.md'), 'Projects/VOL/Docs/Guides');
    assert.equal(parentPath('Release.md'), '');
    assert.equal(noteName('Projects/VOL/Docs/Release.md'), 'Release');
  });

  it('lists the folders between the root and a note', () => {
    assert.deepEqual(foldersBetween('Home/Docs', 'Home/Docs/A/B/Note.md'), [
      'Home/Docs/A',
      'Home/Docs/A/B',
    ]);
    assert.deepEqual(foldersBetween('Home/Docs', 'Home/Docs/Note.md'), []);
    assert.deepEqual(foldersBetween('Home/Docs', 'Projects/VOL/Docs/Note.md'), []);
  });

  it('keeps a typed name to one visible file name', () => {
    assert.equal(cleanFileName('  Release / Deploy '), 'Release - Deploy');
    assert.equal(cleanFileName('.hidden'), 'hidden');
    assert.equal(cleanFileName(' .. '), null);
  });
});
