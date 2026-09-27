import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import VaultMarkdownBoundary from './VaultMarkdownBoundary';

function BrokenEditor(): never {
  throw new Error('Synthetic editor initialization failure');
}

it('keeps the source fallback available when rich editor initialization throws', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const names = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[name],
    });
  const { createRoot } = await import('react-dom/client');
  let failures = 0;
  const caught: unknown[] = [];
  const root = createRoot(document.querySelector('#root')!, {
    onCaughtError: (error) => caught.push(error),
  });
  try {
    await act(async () =>
      root.render(
        <VaultMarkdownBoundary
          fallback={<textarea aria-label="Source" value="<!-- original -->" readOnly />}
          onError={() => failures++}
        >
          <BrokenEditor />
        </VaultMarkdownBoundary>,
      ),
    );
    assert.equal(document.querySelector('textarea')?.value, '<!-- original -->');
    assert.equal(failures, 1);
    assert.equal(caught.length, 1);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
