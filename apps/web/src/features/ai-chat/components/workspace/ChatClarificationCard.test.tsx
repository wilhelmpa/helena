import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import chatWorkspace from '../../../../../messages/en/chatWorkspace.json';
import ChatClarificationCard from './ChatClarificationCard';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let originalGlobalDescriptors: Map<string, PropertyDescriptor | undefined>;

function render(node: React.ReactNode) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ chatWorkspace }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(async () => {
  originalGlobalDescriptors = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  const element = document.querySelector('#root');
  assert.ok(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('ChatClarificationCard', () => {
  it('does nothing on an empty reply', () => {
    const replies: string[] = [];
    render(<ChatClarificationCard onReply={(text) => replies.push(text)} />);
    const button = document.querySelector('button');
    assert.ok(button);
    assert.equal((button as HTMLButtonElement).disabled, true);
  });

  it('sends the trimmed reply and clears the field', () => {
    const replies: string[] = [];
    render(<ChatClarificationCard onReply={(text) => replies.push(text)} />);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    act(() => {
      setValue.call(textarea, '  Yes, go ahead.  ');
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const button = document.querySelector('button') as HTMLButtonElement;
    assert.equal(button.disabled, false);
    act(() => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(replies, ['Yes, go ahead.']);
    assert.equal((document.querySelector('textarea') as HTMLTextAreaElement).value, '');
  });

  it('sends on Enter but keeps Shift+Enter as a newline', () => {
    const replies: string[] = [];
    render(<ChatClarificationCard onReply={(text) => replies.push(text)} />);
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    act(() => {
      setValue.call(textarea, 'ok');
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    act(() =>
      textarea.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    );
    assert.deepEqual(replies, ['ok']);
  });
});
