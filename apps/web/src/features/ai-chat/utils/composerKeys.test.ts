import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composerKeyAction, type ComposerKey, type ComposerKeyState } from './composerKeys';

const key = (name: string, extra: Partial<ComposerKey> = {}): ComposerKey => ({
  key: name,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  ...extra,
});

const idle: ComposerKeyState = { menuOpen: false, busy: false, empty: false, canEditLast: true };

describe('composerKeyAction', () => {
  it('leaves Enter and Shift+Enter to the field: send and a native line break', () => {
    assert.equal(composerKeyAction(key('Enter'), idle), 'default');
    assert.equal(composerKeyAction(key('Enter', { shiftKey: true }), idle), 'default');
  });

  it('breaks the line on ⌘+Enter and Ctrl+Enter', () => {
    assert.equal(composerKeyAction(key('Enter', { metaKey: true }), idle), 'newline');
    assert.equal(composerKeyAction(key('Enter', { ctrlKey: true }), idle), 'newline');
  });

  it('stops an answer being written on Escape, and does nothing otherwise', () => {
    assert.equal(composerKeyAction(key('Escape'), { ...idle, busy: true }), 'stop');
    assert.equal(composerKeyAction(key('Escape'), idle), 'default');
  });

  it('edits the last own message on ↑ only in an empty field while nothing is written', () => {
    assert.equal(composerKeyAction(key('ArrowUp'), { ...idle, empty: true }), 'edit-last');
    assert.equal(composerKeyAction(key('ArrowUp'), idle), 'default');
    assert.equal(
      composerKeyAction(key('ArrowUp'), { ...idle, empty: true, busy: true }),
      'default',
    );
    assert.equal(
      composerKeyAction(key('ArrowUp'), { ...idle, empty: true, canEditLast: false }),
      'default',
    );
    assert.equal(
      composerKeyAction(key('ArrowUp', { shiftKey: true }), { ...idle, empty: true }),
      'default',
    );
  });

  it('drives the / menu while it is open, before anything else', () => {
    const menu = { ...idle, menuOpen: true, busy: true, empty: false };
    assert.equal(composerKeyAction(key('ArrowDown'), menu), 'menu-next');
    assert.equal(composerKeyAction(key('ArrowUp'), menu), 'menu-previous');
    assert.equal(composerKeyAction(key('Enter'), menu), 'menu-pick');
    assert.equal(composerKeyAction(key('Tab'), menu), 'menu-pick');
    assert.equal(composerKeyAction(key('Escape'), menu), 'menu-close');
    // Shift+Enter still breaks the line inside a command's arguments.
    assert.equal(composerKeyAction(key('Enter', { shiftKey: true }), menu), 'default');
  });

  it('never acts on a key that confirms an IME composition', () => {
    const composing = key('Enter', { isComposing: true, metaKey: true });
    assert.equal(composerKeyAction(composing, idle), 'default');
    assert.equal(
      composerKeyAction(key('Escape', { isComposing: true }), { ...idle, busy: true }),
      'default',
    );
  });
});
