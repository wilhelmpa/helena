import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clipboardKeyAction, textFromOsc52 } from './terminalClipboard';

const key = (
  key: string,
  mods: Partial<Record<'ctrl' | 'shift' | 'alt' | 'meta', boolean>> = {},
) => ({
  key,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});

describe('textFromOsc52', () => {
  it('decodes the text tmux sends, UTF-8 included', () => {
    const payload = Buffer.from('grüße ✓').toString('base64');
    assert.equal(textFromOsc52(`c;${payload}`), 'grüße ✓');
    assert.equal(textFromOsc52(`;${payload}`), 'grüße ✓');
  });

  it('ignores queries and anything that is not base64 text', () => {
    assert.equal(textFromOsc52('c;?'), null);
    assert.equal(textFromOsc52('c;'), null);
    assert.equal(textFromOsc52('no-separator'), null);
    assert.equal(textFromOsc52('c;***'), null);
  });
});

describe('clipboardKeyAction', () => {
  it('pastes with Ctrl+V and Ctrl+Shift+V off the Mac, Cmd+V on it', () => {
    assert.equal(clipboardKeyAction(key('v', { ctrl: true }), false, false), 'paste');
    assert.equal(clipboardKeyAction(key('V', { ctrl: true, shift: true }), false, false), 'paste');
    assert.equal(clipboardKeyAction(key('v', { meta: true }), false, true), 'paste');
    assert.equal(clipboardKeyAction(key('v', { ctrl: true }), false, true), null);
  });

  it('keeps Ctrl+C the interrupt unless something is marked', () => {
    assert.equal(clipboardKeyAction(key('c', { ctrl: true }), false, false), null);
    assert.equal(clipboardKeyAction(key('c', { ctrl: true }), true, false), 'copy');
    assert.equal(clipboardKeyAction(key('C', { ctrl: true, shift: true }), false, false), 'copy');
    assert.equal(clipboardKeyAction(key('c', { meta: true }), false, true), 'copy');
    assert.equal(clipboardKeyAction(key('c', { ctrl: true }), true, true), null);
  });

  it('leaves other keys and Alt combinations alone', () => {
    assert.equal(clipboardKeyAction(key('a', { ctrl: true }), true, false), null);
    assert.equal(clipboardKeyAction(key('v', { ctrl: true, alt: true }), false, false), null);
    assert.equal(clipboardKeyAction(key('v'), false, false), null);
  });
});
