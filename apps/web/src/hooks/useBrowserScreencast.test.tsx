import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { useBrowserScreencast } from './useBrowserScreencast';

class ViewerSocket {
  static OPEN = 1;
  static instances: ViewerSocket[] = [];
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage = null;
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {
    ViewerSocket.instances.push(this);
  }
  send(value: string) {
    this.sent.push(value);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.closed = true;
    this.onclose?.();
  }
}

function Probe({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useBrowserScreencast(
    'https://plan.test/browser/projects/fixture',
    active,
    0,
    canvas,
    video,
    true,
    'jpeg',
    false,
    () => {},
  );
  return null;
}

function setup(visible = true) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'https://plan.test',
    pretendToBeVisual: true,
  });
  let hidden = !visible;
  Object.defineProperty(dom.window.document, 'hidden', { get: () => hidden, configurable: true });
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    WebSocket: ViewerSocket,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = new Map(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  ViewerSocket.instances = [];
  const client = new QueryClient();
  const root = createRoot(dom.window.document.getElementById('root')!);
  return {
    render(active: boolean) {
      act(() =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe active={active} />
          </QueryClientProvider>,
        ),
      );
    },
    visible(value: boolean) {
      act(() => {
        hidden = !value;
        dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
      });
    },
    cleanup() {
      act(() => root.unmount());
      client.clear();
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('no socket for a closed panel or hidden document; visible resume and hiding release it', () => {
  const f = setup(false);
  try {
    f.render(false);
    assert.equal(ViewerSocket.instances.length, 0);
    f.render(true);
    assert.equal(ViewerSocket.instances.length, 0);
    f.visible(true);
    assert.equal(ViewerSocket.instances.length, 1);
    const first = ViewerSocket.instances[0]!;
    act(() => first.open());
    assert.deepEqual(JSON.parse(first.sent[0]!), { type: 'hidden', hidden: false });
    f.visible(false);
    assert.equal(first.closed, true);
    assert.deepEqual(JSON.parse(first.sent.at(-1)!), { type: 'hidden', hidden: true });
    f.visible(true);
    assert.equal(ViewerSocket.instances.length, 2);
    const next = ViewerSocket.instances[1]!;
    act(() => next.open());
    f.render(false);
    assert.equal(next.closed, true);
    f.render(true);
    assert.equal(ViewerSocket.instances.length, 3);
  } finally {
    f.cleanup();
  }
  assert.equal(ViewerSocket.instances.at(-1)!.closed, true);
});

test('a connection opening after hide or unmount never subscribes or revives', () => {
  const f = setup();
  let socket: ViewerSocket;
  try {
    f.render(true);
    socket = ViewerSocket.instances[0]!;
    f.visible(false);
    act(() => socket.open());
    assert.equal(socket.closed, true);
    assert.deepEqual(socket.sent, []);
    f.visible(true);
    socket = ViewerSocket.instances[1]!;
  } finally {
    f.cleanup();
  }
  socket!.open();
  assert.equal(socket!.closed, true);
  assert.deepEqual(socket!.sent, []);
});
