import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compareKnowledgeFolders,
  describeFolder,
  folderPathLabels,
  isDirectChildFolder,
  knowledgeFolderLabel,
  readableFolderName,
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

describe('what a folder of Wissen is (O77/O78)', () => {
  it('shows the fixed folders and the ones Helena makes inside them by name, as system folders', () => {
    const labels = [
      'Docs',
      'Docs/Agenten',
      'Files/Belege',
      'Files/Mail',
      'Files/Chat',
      'Files/Browser',
      'Files/Boards',
      'Files/Tasks',
    ].map((path) => describeFolder(path));
    assert.deepEqual(
      labels.map((info) => info.label),
      ['Dokumente', 'Agenten', 'Belege', 'Mail', 'Chats', 'Browser', 'Leinwände', 'Aufgaben'],
    );
    assert.ok(labels.every((info) => info.kind === 'system'));
    assert.notEqual(describeFolder('Files/Belege').Icon, describeFolder('Files/Mail').Icon);
  });

  it('names the folder of a task by its identifier and marks it as a task folder', () => {
    const info = describeFolder('Files/Tasks/VOL-12');
    assert.equal(info.kind, 'task');
    assert.equal(info.label, 'VOL-12');
    // a folder inside a task's folder is the owner's own again
    assert.equal(describeFolder('Files/Tasks/VOL-12/Entwurf').kind, 'custom');
  });

  it('gives what Helena files by itself a readable name and the symbol of its folder', () => {
    const chat = describeFolder('Files/Chat/planung-relaunch');
    assert.equal(chat.kind, 'system');
    assert.equal(chat.label, 'Planung relaunch');
    assert.equal(chat.Icon, describeFolder('Files/Chat').Icon);
    assert.equal(readableFolderName('vol'), 'Vol');
    assert.equal(readableFolderName('2026-09-29'), '2026-09-29');
    assert.equal(readableFolderName('mail_konto'), 'Mail konto');
  });

  it('keeps every folder a person made exactly as typed', () => {
    for (const path of ['Archiv', 'Kunden/Musterfirma', 'docs', 'Files/Eigene-Ordner']) {
      const info = describeFolder(path);
      assert.equal(info.kind, 'custom');
      assert.equal(info.label, path.split('/').at(-1));
    }
    // outside a project's folder (Home, Privat) nothing is renamed
    assert.equal(describeFolder('Docs', undefined, false).label, 'Docs');
    assert.equal(describeFolder('Docs', undefined, false).kind, 'custom');
  });

  it('labels every segment of a path', () => {
    assert.deepEqual(folderPathLabels(['Files', 'Tasks', 'VOL-3']), [
      'Ablage',
      'Aufgaben',
      'VOL-3',
    ]);
    assert.deepEqual(folderPathLabels(['Files', 'Chat', 'daily-standup']), [
      'Ablage',
      'Chats',
      'Daily standup',
    ]);
  });
});
