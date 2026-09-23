import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileViewKind, highlightLanguage } from './fileKinds';

describe('fileViewKind', () => {
  it('opens each kind in its viewer', () => {
    assert.equal(fileViewKind('Rechnung.PDF'), 'pdf');
    assert.equal(fileViewKind('scan', 'application/pdf'), 'pdf');
    assert.equal(fileViewKind('foto.jpeg'), 'image');
    assert.equal(fileViewKind('memo.m4a', 'audio/mp4'), 'audio');
    assert.equal(fileViewKind('clip.mov', 'video/quicktime'), 'video');
    assert.equal(fileViewKind('Notiz.md'), 'markdown');
    assert.equal(fileViewKind('index.ts', 'text/plain; charset=utf-8'), 'text');
    assert.equal(fileViewKind('Angebot.docx'), 'office');
    assert.equal(fileViewKind('archiv.zip', 'application/zip'), 'other');
  });

  it('never shows active content as text or image', () => {
    assert.equal(fileViewKind('page.html', 'text/html'), 'other');
    assert.equal(fileViewKind('logo.svg', 'image/svg+xml'), 'other');
  });
});

describe('highlightLanguage', () => {
  it('names the language of a source file and none for plain text', () => {
    assert.equal(highlightLanguage('server.mjs'), 'javascript');
    assert.equal(highlightLanguage('config.YML'), 'yaml');
    assert.equal(highlightLanguage('notes.txt'), undefined);
  });
});
