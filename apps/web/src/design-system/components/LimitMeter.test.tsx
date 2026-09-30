import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import { LimitMeter } from './LimitMeter';

const messages = {
  common: {
    limit: {
      count: '{used, number} / {limit, number} Zeichen',
      tooLong: 'Zu lang – bitte kürzen oder konsolidieren lassen.',
      nearlyFull: 'Fast voll: noch {left, number} Zeichen frei.',
      truncated: 'Wird für das Modell gekürzt.',
    },
  },
};

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
  dom = new JSDOM('<!doctype html><div id="root"></div>');
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

function show(props: Parameters<typeof LimitMeter>[0]) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <LimitMeter {...props} />
      </NextIntlClientProvider>,
    ),
  );
  return document.querySelector('.ds-limit');
}

describe('LimitMeter', () => {
  it("shows the count with the language's thousands separator", () => {
    const meter = show({ used: 1840, limit: 2200 });
    assert.equal(meter?.getAttribute('data-state'), 'ok');
    assert.match(meter?.textContent ?? '', /1\.840 \/ 2\.200 Zeichen/);
  });

  it('warns above 90 % and says how much is left', () => {
    const meter = show({ used: 2000, limit: 2200 });
    assert.equal(meter?.getAttribute('data-state'), 'warning');
    assert.match(meter?.textContent ?? '', /noch 200 Zeichen frei/);
  });

  it('is full above the limit and explains what to do', () => {
    const meter = show({ used: 2300, limit: 2200 });
    assert.equal(meter?.getAttribute('data-state'), 'full');
    assert.match(meter?.textContent ?? '', /Zu lang – bitte kürzen oder konsolidieren lassen/);
  });

  it('says when the model only sees a shortened text', () => {
    assert.match(show({ used: 100, limit: 2200, truncated: true })?.textContent ?? '', /gekürzt/);
  });

  it('shows nothing without a limit', () => {
    assert.equal(show({ used: 100, limit: null }), null);
    assert.equal(show({ used: 100, limit: undefined }), null);
  });
});
