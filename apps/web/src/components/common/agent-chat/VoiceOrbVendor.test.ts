import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const source = readFileSync(
  new URL('../../../../public/vendor/shipnotes/voice-orb.js', import.meta.url),
  'utf8',
);

function browser(reducedMotion: boolean) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { runScripts: 'outside-only' });
  const { window } = dom;
  let frames = 0;
  Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
  window.matchMedia = (query) =>
    ({
      matches: reducedMotion && query.includes('reduced-motion'),
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
  window.requestAnimationFrame = () => ++frames;
  window.cancelAnimationFrame = () => {};
  Object.defineProperty(window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  const context = {
    createRadialGradient: () => ({ addColorStop() {} }),
    clearRect() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
  };
  window.HTMLCanvasElement.prototype.getContext = ((kind: string) =>
    kind === '2d'
      ? context
      : null) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
  window.eval(source);
  return { dom, window, frames: () => frames };
}

it('accepts every used custom element property through React 19 DOM rendering', async () => {
  const { dom, window, frames } = browser(true);
  const globals = [
    'window',
    'document',
    'HTMLElement',
    'customElements',
    'IS_REACT_ACT_ENVIRONMENT',
  ] as const;
  const previous = new Map(
    globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: window },
    document: { configurable: true, value: window.document },
    HTMLElement: { configurable: true, value: window.HTMLElement },
    customElements: { configurable: true, value: window.customElements },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(window.document.querySelector('#root')!);
  try {
    await act(async () => {
      root.render(
        createElement('voice-orb', {
          state: 'listening',
          particles: '200',
          bands: [0.2, 0.3, 0.4],
        }),
      );
    });
    const orb = window.document.querySelector('voice-orb')!;
    const prototype = Object.getPrototypeOf(orb);
    for (const prop of ['state', 'particles', 'bands']) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, prop);
      assert.equal(typeof descriptor?.get, 'function');
      assert.equal(typeof descriptor?.set, 'function');
    }
    assert.equal(orb.getAttribute('state'), 'listening');
    assert.equal(orb.getAttribute('particles'), '200');
    assert.equal(frames(), 0);
    assert.deepEqual(
      Array.from((orb as HTMLElement & { _externalBands: number[] })._externalBands),
      [0.2, 0.3, 0.4],
    );
    await act(async () => {
      root.render(
        createElement('voice-orb', { state: 'speaking', particles: '200', bands: [0.6, 0.5, 0.4] }),
      );
    });
    assert.equal(window.document.querySelector('voice-orb'), orb);
    assert.equal(orb.getAttribute('state'), 'speaking');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

it('blends state and external audio bands without replacing the element', () => {
  const { dom, window, frames } = browser(false);
  const orb = window.document.createElement('voice-orb') as HTMLElement & {
    state: string;
    particles: string;
    bands: number[];
    _weights: number[];
    _tick: (now: number) => void;
  };
  orb.particles = '200';
  window.document.body.append(orb);
  assert.equal(frames(), 1);
  orb.state = 'speaking';
  orb.bands = [0.8, 0.5, 0.3];
  orb._tick(1000);
  assert.ok(orb._weights[0]! > 0 && orb._weights[3]! > 0);
  assert.ok(orb.bands[0]! > 0 && orb.bands[1]! > 0 && orb.bands[2]! > 0);
  const beforeHide = frames();
  Object.defineProperty(window.document, 'hidden', { configurable: true, value: true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(frames(), beforeHide);
  Object.defineProperty(window.document, 'hidden', { configurable: true, value: false });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(frames(), beforeHide + 1);
  window.document.body.removeChild(orb);
  dom.window.close();
});
