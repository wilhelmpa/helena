import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import common from '../../../messages/en/common.json';
import { deriveStatus } from '@/utils/helenaStatus';
import Orb from './Orb';

const globals = [
  'window',
  'document',
  'HTMLElement',
  'customElements',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let previous: Map<string, PropertyDescriptor | undefined>;
let dom: JSDOM;
let root: Root;
let container: HTMLElement;

async function render(state: ReturnType<typeof deriveStatus>) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ common }} timeZone="UTC">
        <Orb state={state} size="large" />
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(async () => {
  previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    customElements: { configurable: true, value: dom.window.customElements },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  dom.window.matchMedia = () =>
    ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
  dom.window.HTMLCanvasElement.prototype.getContext = (() => ({
    getExtension: () => null,
  })) as unknown as typeof dom.window.HTMLCanvasElement.prototype.getContext;
  container = document.querySelector('#root')!;
  root = (await import('react-dom/client')).createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe('large Orb', () => {
  it('exposes the four visual states from voice and stream signals', async () => {
    customElements.define('voice-orb', class extends dom.window.HTMLElement {});
    for (const [signals, expected] of [
      [{}, 'idle'],
      [{ voicePhase: 'listening' }, 'listening'],
      [{ chat: 'streaming' }, 'thinking'],
      [{ voicePhase: 'speaking', chat: 'streaming' }, 'speaking'],
    ] as const) {
      await render(deriveStatus(signals));
      const host = container.querySelector('[data-status]');
      assert.equal(host?.getAttribute('data-status'), expected);
      assert.ok(host?.getAttribute('aria-label'));
      assert.equal(host?.querySelector('voice-orb')?.getAttribute('state'), expected);
    }
  });

  it('has no colored placeholder surface before the WebGL component is ready', async () => {
    await render('idle');
    const host = container.querySelector('[data-status="idle"]');
    assert.equal(host?.getAttribute('data-ready'), 'false');
    assert.equal(host?.querySelector('[aria-hidden="true"]'), null);
  });

  it('uses a static state-colored glow with reduced motion', async () => {
    dom.window.matchMedia = () =>
      ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList;
    await render('speaking');
    assert.equal(container.querySelector('voice-orb'), null);
    assert.ok(container.querySelector('[data-status="speaking"] [aria-hidden="true"]'));
  });
});
