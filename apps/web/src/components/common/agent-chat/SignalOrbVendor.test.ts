import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { JSDOM } from 'jsdom';

const source = readFileSync(
  new URL('../../../../public/vendor/shipnotes/signal-orb.js', import.meta.url),
  'utf8',
);

it('keeps the vendored orb static without WebGL and releases listeners on removal', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  let frames = 0;
  let disconnected = 0;
  let mediaRemoved = 0;
  let visibilityRemoved = 0;
  const removeEventListener = window.document.removeEventListener.bind(window.document);
  window.document.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === 'visibilitychange') visibilityRemoved++;
    removeEventListener(type, listener, options);
  }) as typeof window.document.removeEventListener;
  window.matchMedia = () =>
    ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => mediaRemoved++,
    }) as unknown as MediaQueryList;
  window.requestAnimationFrame = () => ++frames;
  window.cancelAnimationFrame = () => {};
  Object.defineProperty(window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {
        disconnected++;
      }
    },
  });
  const context = {
    createRadialGradient: () => ({ addColorStop: () => {} }),
    setTransform: () => {},
    clearRect: () => {},
    fillRect: () => {},
    drawImage: () => {},
  };
  window.HTMLCanvasElement.prototype.getContext = ((kind: string) =>
    kind === '2d'
      ? context
      : null) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;

  window.eval(source);
  const orb = window.document.createElement('signal-orb');
  orb.setAttribute('particles', '200');
  window.document.body.append(orb);
  assert.equal(frames, 0);
  window.document.body.removeChild(orb);
  assert.equal(disconnected, 1);
  assert.equal(mediaRemoved, 1);
  assert.equal(visibilityRemoved, 1);
  dom.window.close();
});

it('pauses a WebGL orb in a hidden tab and frees its context on removal', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  let hidden = false;
  let frames = 0;
  let cancelled = 0;
  let deleted = 0;
  let contextReleased = 0;
  let onMotion: (() => void) | undefined;
  const media = {
    matches: false,
    addEventListener: (_type: string, callback: () => void) => {
      onMotion = callback;
    },
    removeEventListener: () => {},
  };
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });
  window.matchMedia = () => media as unknown as MediaQueryList;
  window.requestAnimationFrame = () => ++frames;
  window.cancelAnimationFrame = () => {
    cancelled++;
  };
  Object.defineProperty(window, 'ResizeObserver', {
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  const context2d = {
    createRadialGradient: () => ({ addColorStop: () => {} }),
    setTransform: () => {},
    clearRect: () => {},
    fillRect: () => {},
    drawImage: () => {},
  };
  const gl = new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_target, key) => {
        if (key === 'getProgramParameter') return () => true;
        if (key === 'getAttribLocation') return () => 0;
        if (key === 'createShader' || key === 'createProgram' || key === 'createBuffer')
          return () => ({});
        if (key === 'getExtension') return () => ({ loseContext: () => contextReleased++ });
        if (key === 'deleteBuffer' || key === 'deleteProgram') return () => deleted++;
        if (typeof key === 'string' && key === key.toUpperCase()) return 1;
        return () => {};
      },
    },
  );
  window.HTMLCanvasElement.prototype.getContext = ((kind: string) =>
    kind === 'webgl'
      ? gl
      : context2d) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;

  window.eval(source);
  const orb = window.document.createElement('signal-orb');
  orb.setAttribute('particles', '200');
  window.document.body.append(orb);
  assert.equal(frames, 1);
  hidden = true;
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(frames, 1);
  hidden = false;
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(frames, 2);
  media.matches = true;
  onMotion?.();
  assert.equal(frames, 2);
  window.document.body.removeChild(orb);
  assert.ok(cancelled >= 3);
  assert.equal(deleted, 2);
  assert.equal(contextReleased, 1);
  dom.window.close();
});
