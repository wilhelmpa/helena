import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import { clampClockSkew, RelativeTimeProvider, useRelativeTime } from './relativeTimeContext';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'setInterval',
  'clearInterval',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

let dom: JSDOM;
let root: Root;
let intervalRegistrations: number;
let originalGlobalDescriptors: Map<string, PropertyDescriptor | undefined>;

function RelativeTimeProbe({ value }: { value: string }) {
  const relativeTime = useRelativeTime();
  return <span>{relativeTime(value)}</span>;
}

beforeEach(async () => {
  originalGlobalDescriptors = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  intervalRegistrations = 0;

  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    setInterval: {
      configurable: true,
      value: () => {
        intervalRegistrations += 1;
        return 1;
      },
    },
    clearInterval: { configurable: true, value: () => undefined },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });

  const { createRoot } = await import('react-dom/client');
  const rootElement = document.querySelector('#root');
  assert.ok(rootElement);
  root = createRoot(rootElement);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('RelativeTimeProvider', () => {
  it('uses the wall clock before the first interval tick', () => {
    const current = new Date();
    const requestTime = new Date(current.getTime() - 2 * 60_000);

    act(() =>
      root.render(
        <NextIntlClientProvider locale="en" messages={{}} now={requestTime} timeZone="UTC">
          <RelativeTimeProvider>
            <RelativeTimeProbe value={current.toISOString()} />
            <RelativeTimeProbe value={current.toISOString()} />
          </RelativeTimeProvider>
        </NextIntlClientProvider>,
      ),
    );

    assert.equal(intervalRegistrations, 1);
    assert.deepEqual(
      [...document.querySelectorAll('span')].map((element) => element.textContent),
      ['now', 'now'],
    );
  });
});

describe('clampClockSkew', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');

  it('reads a moment a few seconds ahead (the server clock) as now', () => {
    assert.equal(clampClockSkew(new Date('2026-09-24T12:00:02.000Z'), now), now);
  });

  it('keeps the past and the real future as they are', () => {
    const past = new Date('2026-09-24T11:59:58.000Z');
    const later = new Date('2026-09-24T12:05:00.000Z');
    assert.equal(clampClockSkew(past, now), past);
    assert.equal(clampClockSkew(later, now), later);
  });
});
