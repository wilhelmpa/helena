import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareKnowledgeFolders,
  isDirectChildFolder,
  knowledgeFolderLabel,
} from './knowledgeFolders';

describe('fixed vault folder labels', () => {
  it('keeps the raw path names while showing distinct labels', () => {
    assert.deepEqual(
      ['Docs', 'Files', 'Assets', 'Boards', 'Inbox'].map((name) => knowledgeFolderLabel(name)),
      ['Dokumente', 'Ablage', 'Anhänge', 'Leinwände', 'Eingang'],
    );
    assert.equal(knowledgeFolderLabel('Owner Folder'), 'Owner Folder');
    assert.equal(knowledgeFolderLabel('constructor'), 'constructor');
  });

  it('places fixed folders before owner folders', () => {
    assert.deepEqual(
      ['Zeta', 'Inbox', 'Docs', 'Alpha', 'Assets', 'Files', 'Boards'].sort(compareKnowledgeFolders),
      ['Docs', 'Files', 'Assets', 'Boards', 'Inbox', 'Alpha', 'Zeta'],
    );
  });

  it('keeps the live TRADE folders as seven siblings regardless of listing order', () => {
    const names = ['Assets', 'Berichte', 'Boards', 'Docs', 'Files', 'Inbox', 'Strategie-Labor'];
    const items = names.map((name) => ({ kind: 'folder', path: name, name }));
    items.push({ kind: 'folder', path: 'Boards/Skizzen', name: 'Skizzen' });
    assert.deepEqual(
      items
        .filter((item) => isDirectChildFolder(item, ''))
        .sort((a, b) => compareKnowledgeFolders(a.name, b.name))
        .map((item) => item.path),
      ['Docs', 'Files', 'Assets', 'Boards', 'Inbox', 'Berichte', 'Strategie-Labor'],
    );
    assert.deepEqual(
      items.filter((item) => isDirectChildFolder(item, 'Boards')).map((item) => item.path),
      ['Boards/Skizzen'],
    );
  });
});
