import { JSDOM } from 'jsdom';

// A browser window for a component test: jsdom's globals for the time of `run`, React's act
// environment on, everything restored afterwards (the pattern of ProjectLinkSheet.test.tsx).
const NAMES = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLIFrameElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'PointerEvent',
  'localStorage',
  'sessionStorage',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia',
  'ResizeObserver',
  'IS_REACT_ACT_ENVIRONMENT',
];

export async function withDom<T>(url: string, run: (dom: JSDOM) => Promise<T>): Promise<T> {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url, pretendToBeVisual: true });
  // What jsdom lacks and components ask for: media queries (never matching) and a resize
  // observer that never reports.
  Object.assign(dom.window, {
    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  const saved = new Map(
    NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of NAMES) {
    const value =
      name === 'IS_REACT_ACT_ENVIRONMENT'
        ? true
        : (dom.window as unknown as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value:
        typeof value === 'function' && /^[a-z]/.test(name)
          ? (value as (...args: unknown[]) => unknown).bind(dom.window)
          : value,
    });
  }
  try {
    return await run(dom);
  } finally {
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
