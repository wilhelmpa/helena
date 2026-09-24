import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  captureNextCharacter,
  dispatchTerminalKey,
  dispatchTerminalText,
  keyForCharacter,
  NO_MODIFIERS,
} from './terminalKeys';

// A frame document with xterm.js's hidden textarea focused, recording what reaches it.
function terminalDocument() {
  const dom = new JSDOM('<!doctype html><textarea></textarea>');
  const doc = dom.window.document;
  const textarea = doc.querySelector('textarea')!;
  textarea.focus();
  const keys: { type: string; key: string; keyCode: number; ctrl: boolean; alt: boolean }[] = [];
  const inputs: string[] = [];
  for (const type of ['keydown', 'keyup']) {
    textarea.addEventListener(type, (event) => {
      const key = event as KeyboardEvent;
      keys.push({ type, key: key.key, keyCode: key.keyCode, ctrl: key.ctrlKey, alt: key.altKey });
    });
  }
  textarea.addEventListener('input', (event) => inputs.push((event as InputEvent).data ?? ''));
  return { dom, doc, textarea, keys, inputs };
}

describe('keyForCharacter', () => {
  it('gives letters, digits, space and punctuation the keyCode xterm.js reads', () => {
    assert.deepEqual(keyForCharacter('c'), { key: 'c', code: 'KeyC', keyCode: 67 });
    assert.deepEqual(keyForCharacter('C'), { key: 'C', code: 'KeyC', keyCode: 67 });
    assert.deepEqual(keyForCharacter('5'), { key: '5', code: 'Digit5', keyCode: 53 });
    assert.deepEqual(keyForCharacter(' '), { key: ' ', code: 'Space', keyCode: 32 });
    assert.deepEqual(keyForCharacter('|'), { key: '|', code: 'Backslash', keyCode: 220 });
    assert.equal(keyForCharacter('ä').keyCode, 0);
  });
});

describe('dispatchTerminalKey', () => {
  it('presses a key with its keyCode and the held modifiers', () => {
    const { doc, keys } = terminalDocument();
    dispatchTerminalKey(doc, keyForCharacter('c'), { ctrl: true, alt: false });
    assert.deepEqual(keys, [
      { type: 'keydown', key: 'c', keyCode: 67, ctrl: true, alt: false },
      { type: 'keyup', key: 'c', keyCode: 67, ctrl: true, alt: false },
    ]);
  });
});

describe('dispatchTerminalText', () => {
  it('types text as one insertText input with carriage returns', () => {
    const { doc, inputs } = terminalDocument();
    dispatchTerminalText(doc, 'ls -la\necho hi\r\n');
    assert.deepEqual(inputs, ['ls -la\recho hi\r']);
  });
});

describe('captureNextCharacter', () => {
  it('takes over the next typed character, from a key or from the soft keyboard', () => {
    const { dom, doc, textarea, keys, inputs } = terminalDocument();
    const taken: string[] = [];
    const stop = captureNextCharacter(doc, (character) => taken.push(character));

    const typed = new dom.window.KeyboardEvent('keydown', {
      key: 'c',
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(typed);
    assert.equal(typed.defaultPrevented, true);
    assert.deepEqual(keys, []);

    const soft = new dom.window.InputEvent('beforeinput', {
      data: 'd',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(soft);
    assert.equal(soft.defaultPrevented, true);
    assert.deepEqual(taken, ['c', 'd']);

    // Autocorrect inserting a word at once: the first character is taken, the rest typed.
    textarea.dispatchEvent(
      new dom.window.InputEvent('beforeinput', {
        data: 'git',
        inputType: 'insertText',
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.deepEqual(taken, ['c', 'd', 'g']);
    assert.deepEqual(inputs, ['it']);

    // Its own keys (the bar's, or the modified one it sends) pass through.
    dispatchTerminalKey(doc, keyForCharacter('x'), NO_MODIFIERS);
    assert.equal(keys.length, 2);
    assert.deepEqual(taken, ['c', 'd', 'g']);

    stop();
    textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    assert.deepEqual(taken, ['c', 'd', 'g']);
  });

  it('leaves keys alone that already carry a modifier or name no character', () => {
    const { dom, doc, textarea } = terminalDocument();
    const taken: string[] = [];
    captureNextCharacter(doc, (character) => taken.push(character));
    textarea.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    textarea.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }),
    );
    textarea.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true }),
    );
    assert.deepEqual(taken, []);
  });
});
