import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import devices from '../../../../messages/de/devices.json';
import { RelativeTimeProvider } from '@/context/relativeTimeContext';
import DevicesGuide from './DevicesGuide';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let originalGlobalDescriptors: Map<string, PropertyDescriptor | undefined>;

function render(node: React.ReactNode) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="de" messages={{ devices }} timeZone="UTC">
        <RelativeTimeProvider>{node}</RelativeTimeProvider>
      </NextIntlClientProvider>,
    ),
  );
  return document.body.textContent ?? '';
}

beforeEach(async () => {
  originalGlobalDescriptors = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
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
  const element = document.querySelector('#root');
  assert.ok(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('DevicesGuide', () => {
  it('names the LAN address only when one is configured', () => {
    render(<DevicesGuide lanAddress="tcp://192.168.2.220:22000" />);
    const codes = [...document.querySelectorAll('code')].map((code) => code.textContent);
    assert.ok(codes.includes('tcp://192.168.2.220:22000, dynamic'));
    assert.ok(codes.includes('~/Helena'));
    assert.ok(codes.includes('Files/Mail'));
    assert.doesNotMatch(render(<DevicesGuide lanAddress={null} />), /dynamic/);
  });
});
