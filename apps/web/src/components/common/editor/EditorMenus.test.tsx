import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import type { Editor } from '@tiptap/react';
import common from '../../../../messages/en/common.json';

// O97: the bubble menus of the editor gave tiptap a new `options` object (and `shouldShow`)
// at every render. The menu re-registers its plugin whenever they change, which is one more
// editor transaction, which renders the editor again — a permanent exchange that React stopped
// with "Maximum update depth exceeded" once many keystrokes came in one go. A render must never
// cause a transaction.

const replaced = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let saved: Map<string, PropertyDescriptor | undefined>;

beforeEach(async () => {
  saved = new Map(
    replaced.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
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
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

async function transactionsWhileRerendering(kind: 'selection' | 'table'): Promise<number> {
  const { Editor: TiptapEditor } = await import('@tiptap/core');
  const { default: StarterKit } = await import('@tiptap/starter-kit');
  const { default: EditorSelectionMenu } = await import('./EditorSelectionMenu');
  const { default: EditorTableMenu } = await import('./EditorTableMenu');
  const editor = new TiptapEditor({
    element: document.createElement('div'),
    extensions: [StarterKit],
    content: '<p>text</p>',
  }) as unknown as Editor;
  let rerender: () => void = () => undefined;
  function Host() {
    const [, setCount] = useState(0);
    rerender = () => setCount((count) => count + 1);
    return kind === 'selection' ? (
      <EditorSelectionMenu editor={editor} />
    ) : (
      <EditorTableMenu editor={editor} />
    );
  }
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ common }} timeZone="UTC">
        <Host />
      </NextIntlClientProvider>,
    ),
  );
  // Let the menus register their plugins.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  let transactions = 0;
  editor.on('transaction', () => (transactions += 1));
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      rerender();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  editor.destroy();
  return transactions;
}

describe('editor bubble menus', () => {
  it('the selection menu causes no transaction by rendering', async () => {
    assert.equal(await transactionsWhileRerendering('selection'), 0);
  });

  it('the table menu causes no transaction by rendering', async () => {
    assert.equal(await transactionsWhileRerendering('table'), 0);
  });
});
