import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useWorkspacePanel } from './useWorkspacePanel';

let panel: ReturnType<typeof useWorkspacePanel>;
function Probe({ defaultOpen = false }: { defaultOpen?: boolean }) {
  panel = useWorkspacePanel({ defaultOpen });
  return null;
}

test('explicitly closed tools stay closed when Home remounts, while tool and layout choices survive', () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://plan.test' });
  const globals = ['window', 'document', 'navigator', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
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
  let root = createRoot(dom.window.document.getElementById('root')!);
  try {
    act(() => root.render(<Probe defaultOpen />));
    assert.equal(panel.open, true);
    act(() => panel.openTool('inbox'));
    act(() => panel.toggleMode());
    act(() => panel.setOpen(false));
    act(() => root.unmount());
    root = createRoot(dom.window.document.getElementById('root')!);
    act(() => root.render(<Probe defaultOpen />));
    assert.equal(panel.open, false);
    assert.equal(panel.activeTool, 'inbox');
    assert.equal(panel.mode, 'push');
    act(() => panel.toggleTool('code'));
    assert.equal(panel.open, true);
    assert.equal(panel.activeTool, 'code');
    act(() => panel.toggleTool('code'));
    assert.equal(panel.open, false);
  } finally {
    act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
