import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useWorkspacePanel } from './useWorkspacePanel';

let panel: ReturnType<typeof useWorkspacePanel>;
function Probe({
  defaultOpen = false,
  projectKey = null,
}: {
  defaultOpen?: boolean;
  projectKey?: string | null;
}) {
  panel = useWorkspacePanel({ defaultOpen, projectKey });
  return null;
}

function setup() {
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
  let root: Root | null = createRoot(dom.window.document.getElementById('root')!);
  return {
    dom,
    root: () => root!,
    remount: () => {
      root = createRoot(dom.window.document.getElementById('root')!);
    },
    unmount: () => {
      act(() => root?.unmount());
      root = null;
    },
    cleanup: () => {
      if (root) act(() => root?.unmount());
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('explicitly closed tools stay closed when Home remounts, while tool and layout choices survive', () => {
  const test = setup();
  try {
    act(() => test.root().render(<Probe defaultOpen />));
    assert.equal(panel.open, true);
    act(() => panel.openTool('inbox'));
    act(() => panel.toggleMode());
    act(() => panel.setOpen(false));
    test.unmount();
    test.remount();
    act(() => test.root().render(<Probe defaultOpen />));
    assert.equal(panel.open, false);
    assert.equal(panel.activeTool, 'inbox');
    assert.equal(panel.mode, 'push');
  } finally {
    test.cleanup();
  }
});

test('a project-scoped tool never survives a project change or a return Home', () => {
  const test = setup();
  try {
    act(() => test.root().render(<Probe projectKey="SYSQA" />));
    act(() => panel.openTool('code'));
    assert.equal(panel.open, true);
    act(() => test.root().render(<Probe projectKey={null} />));
    assert.equal(panel.open, false);

    const browserSession = panel.toolSession;
    act(() => panel.openTool('browser'));
    assert.equal(panel.toolSession, browserSession + 1);
    act(() => panel.setOpen(false));
    act(() => panel.openTool('browser'));
    assert.equal(panel.toolSession, browserSession + 2);

    act(() => panel.openTool('chat'));
    act(() => test.root().render(<Probe projectKey="OTHER" />));
    assert.equal(panel.open, true);
    assert.equal(panel.activeTool, 'chat');

    act(() => panel.openTool('terminal'));
    test.unmount();
    test.remount();
    act(() => test.root().render(<Probe projectKey="SYSQA" />));
    assert.equal(panel.open, false);
  } finally {
    test.cleanup();
  }
});

test('a user click cannot be overwritten by a later restore pass', () => {
  const test = setup();
  try {
    localStorage.setItem('workspace:panel:open', 'closed');
    act(() => test.root().render(<Probe defaultOpen />));
    assert.equal(panel.open, false);
    act(() => panel.openTool('chat'));
    assert.equal(panel.open, true);
    act(() => test.root().render(<Probe defaultOpen />));
    assert.equal(panel.open, true);
  } finally {
    test.cleanup();
  }
});

test('a cross-project internal browser link opens its source panel in a preserved Shell and removes only the tool parameter', () => {
  const t = setup();
  try {
    act(() => t.root().render(<Probe projectKey="VOL" />));
    act(() => panel.openTool('terminal'));
    t.dom.window.history.pushState({}, '', '/project/OTHER?tool=browser&keep=1');
    act(() => t.root().render(<Probe projectKey="OTHER" />));
    assert.equal(panel.activeTool, 'browser');
    assert.equal(panel.open, true);
    assert.equal(t.dom.window.location.search, '?keep=1');
    t.dom.window.history.pushState({}, '', '/?tool=browser');
    act(() => t.root().render(<Probe projectKey={null} />));
    assert.equal(panel.open, true);
    assert.equal(panel.activeTool, 'browser');
    assert.equal(t.dom.window.location.search, '');
  } finally {
    t.cleanup();
  }
});

test('the selected tool is restored separately for each project', () => {
  const t = setup();
  try {
    act(() => t.root().render(<Probe projectKey="TRADE" />));
    act(() => panel.openTool('terminal'));
    act(() => t.root().render(<Probe projectKey="VOL" />));
    assert.equal(panel.activeTool, 'chat');
    act(() => panel.openTool('browser'));
    act(() => t.root().render(<Probe projectKey="TRADE" />));
    assert.equal(panel.activeTool, 'terminal');
    act(() => t.root().render(<Probe projectKey="VOL" />));
    assert.equal(panel.activeTool, 'browser');
  } finally {
    t.cleanup();
  }
});
