import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { act, useEffect, useRef } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { isTypingTarget } from '@/utils/hotkeys';
import { useTypeToFocus } from './useTypeToFocus';

// react-dom decides at import whether the browser has `input` events; imported before a
// document exists it falls back to an old IE polyfill that breaks on focus changes.
const bootDom = new JSDOM('');
Object.assign(globalThis, { window: bootDom.window, document: bootDom.window.document });
const { createRoot } = await import('react-dom/client');

// O64 (owner, 29.09.): typing in the big chat opened an overlay. With the focus off the
// field (after clicking send), a letter reached the app's one-key shortcuts — "b" opens
// „Neues Projekt“, "l" lays the tool panel over the chat. This page stands in for the Shell:
// the shortcut layer is a bubbling window listener, as in hooks/useKeyboardShortcuts.
const globals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Element',
  'IS_REACT_ACT_ENVIRONMENT',
];
let dom: JSDOM;
let root: Root;
let saved: Map<string, PropertyDescriptor | undefined>;
let shortcuts: string[];

function Page({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useTypeToFocus(ref, enabled);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      shortcuts.push(event.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div>
      <textarea ref={ref} aria-label="composer" />
      <button type="button">send</button>
      <div role="dialog" data-state="closed">
        <input aria-label="elsewhere" />
      </div>
    </div>
  );
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new dom.window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://plan.test' });
  saved = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[key],
    });
  root = createRoot(dom.window.document.getElementById('root')!);
  shortcuts = [];
});

afterEach(() => {
  act(() => root.unmount());
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
  dom.window.close();
});

test('a letter typed after clicking send goes into the composer, not to a shortcut', () => {
  act(() => root.render(<Page enabled />));
  const doc = dom.window.document;
  const button = doc.querySelector('button')!;
  button.focus();
  press(button, 'b');
  press(doc.body, 'l');
  assert.deepEqual(shortcuts, []);
  assert.equal(doc.activeElement, doc.querySelector('textarea'));
});

test('without the big chat the shortcuts keep their keys', () => {
  act(() => root.render(<Page enabled={false} />));
  press(dom.window.document.body, 'b');
  assert.deepEqual(shortcuts, ['b']);
});

test('modified keys, Space on a button and fields elsewhere are left alone', () => {
  act(() => root.render(<Page enabled />));
  const doc = dom.window.document;
  const textarea = doc.querySelector('textarea')!;
  press(doc.body, 'k', { metaKey: true });
  assert.deepEqual(shortcuts, ['k']);
  press(doc.querySelector('button')!, ' ');
  assert.deepEqual(shortcuts, ['k', ' ']);
  const input = doc.querySelector('input')!;
  input.focus();
  press(input, 'x');
  assert.equal(doc.activeElement, input);
  assert.notEqual(doc.activeElement, textarea);
});
