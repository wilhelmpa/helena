import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from './prompt-input';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLTextAreaElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let saved: Map<string, PropertyDescriptor | undefined>;

beforeEach(async () => {
  saved = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function renderComposer(value: string, sent: string[], disabled = false) {
  act(() =>
    root.render(
      <PromptInput onSubmit={({ text }) => sent.push(text)}>
        <PromptInputTextarea value={value} onChange={() => {}} />
        <PromptInputSubmit label="Send" disabled={disabled} />
      </PromptInput>,
    ),
  );
  return document.querySelector('textarea')!;
}

function press(target: Element, init: KeyboardEventInit) {
  const event = new dom.window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('PromptInputTextarea', () => {
  it('sends the text on Enter', () => {
    const sent: string[] = [];
    const field = renderComposer('Status?', sent);
    const event = press(field, { key: 'Enter' });
    assert.deepEqual(sent, ['Status?']);
    assert.equal(event.defaultPrevented, true);
  });

  it('leaves Shift+Enter to the field, which breaks the line', () => {
    const sent: string[] = [];
    const field = renderComposer('Status?', sent);
    const event = press(field, { key: 'Enter', shiftKey: true });
    assert.deepEqual(sent, []);
    assert.equal(event.defaultPrevented, false);
  });

  it('does not send while an IME composition is running', () => {
    const sent: string[] = [];
    const field = renderComposer('にほ', sent);
    press(field, { key: 'Enter', isComposing: true });
    assert.deepEqual(sent, []);
  });

  it('does not send while the send button is disabled', () => {
    const sent: string[] = [];
    const field = renderComposer('', sent, true);
    press(field, { key: 'Enter' });
    assert.deepEqual(sent, []);
  });
});
