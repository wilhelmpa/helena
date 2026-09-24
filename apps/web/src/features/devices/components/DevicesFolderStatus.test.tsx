import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import devices from '../../../../messages/de/devices.json';
import type { SyncFolder } from '@/lib/api/endpoints/deviceSync';
import { RelativeTimeProvider } from '@/context/relativeTimeContext';
import DevicesFolderStatus from './DevicesFolderStatus';

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

const folder: SyncFolder = {
  label: 'Helena',
  path: '/srv/volition/vault',
  state: 'sync-preparing',
  stateChangedAt: null,
  lastScanAt: new Date().toISOString(),
  lastFileAt: null,
  lastFileName: null,
  needItems: 3,
  error: null,
  fileErrorCount: 1,
  fileErrors: [{ path: 'Home/locked.md', error: 'permission denied' }],
};

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

describe('DevicesFolderStatus', () => {
  it('shows the state, what is left and the files that failed', () => {
    const text = render(<DevicesFolderStatus folder={folder} />);
    assert.match(text, /Wird synchronisiert/);
    assert.match(text, /3 Dateien noch zu synchronisieren/);
    assert.match(text, /1 Datei konnte nicht synchronisiert werden/);
    assert.match(text, /Home\/locked\.md: permission denied/);
    assert.match(text, /Zuletzt empfangene DateiNoch nie/);
  });

  it('says when the folder is missing', () => {
    assert.match(render(<DevicesFolderStatus folder={null} />), /Der Ordner Helena fehlt/);
  });
});
