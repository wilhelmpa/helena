import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attachTerminalClipboard, clipboardKeyAction, textFromOsc52 } from './terminalClipboard';

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

describe('attachTerminalClipboard', () => {
  it('silences the frame page\'s "Leave site?" before its terminal is up', () => {
    // The frame's page, loaded, while wetty has not made its terminal yet.
    const page = new EventTarget() as EventTarget & { document: object };
    page.document = {};
    const frame = Object.assign(new EventTarget(), { contentWindow: page });
    const saved = globalThis.window;
    Object.assign(globalThis, { window: { setInterval: () => 0, clearInterval: () => {} } });
    try {
      const detach = attachTerminalClipboard(frame as unknown as HTMLIFrameElement, () => {});
      let asked = false;
      // wetty's own handler, added once its socket connects.
      page.addEventListener('beforeunload', () => (asked = true));
      page.dispatchEvent(new Event('beforeunload'));
      assert.equal(asked, false);
      detach();
    } finally {
      Object.assign(globalThis, { window: saved });
    }
  });
});
