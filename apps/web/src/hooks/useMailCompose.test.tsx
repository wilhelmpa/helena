import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { setComposeDraft, takeFreshDraft, useComposeDraft } from './useMailCompose';

let shown: number | null = null;
function Probe() {
  shown = useComposeDraft();
  return null;
}

test('shares the open draft, keeps it for a reload and marks a started one once', () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://plan.test' });
  const globals = ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
  const descriptors = new Map(
    globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of globals)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[key],
    });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    act(() => root.render(<Probe />));
    act(() => setComposeDraft(12, true));
    assert.equal(shown, 12);
    assert.equal(localStorage.getItem('mail:compose:draft'), '12');
    assert.equal(takeFreshDraft(12), true);
    assert.equal(takeFreshDraft(12), false);

    act(() => setComposeDraft(13));
    assert.equal(takeFreshDraft(13), false);
    act(() => setComposeDraft(null));
    assert.equal(shown, null);
    assert.equal(localStorage.getItem('mail:compose:draft'), null);
  } finally {
    act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
