import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareKnowledgeFolders, knowledgeFolderLabel } from './knowledgeFolders';

describe('fixed vault folder labels', () => {
  it('keeps the raw path names while showing distinct labels', () => {
    assert.deepEqual(
      ['Docs', 'Files', 'Assets', 'Boards', 'Inbox'].map((name) => knowledgeFolderLabel(name)),
      ['Dokumente', 'Dateien', 'Anhänge', 'Leinwände', 'Eingang'],
    );
    assert.equal(knowledgeFolderLabel('Owner Folder'), 'Owner Folder');
  });

  it('places fixed folders before owner folders', () => {
    assert.deepEqual(
      ['Zeta', 'Inbox', 'Docs', 'Alpha', 'Assets', 'Files', 'Boards'].sort(compareKnowledgeFolders),
      ['Docs', 'Files', 'Assets', 'Boards', 'Inbox', 'Alpha', 'Zeta'],
    );
  });
});
