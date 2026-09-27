import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/en/routines.json';
import { RoutineGateField } from './RoutineGateField';

let dom: JSDOM;
let root: Root;
let saved: Map<string, PropertyDescriptor | undefined>;
const globals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLFormElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

beforeEach(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  saved = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLFormElement: { configurable: true, value: dom.window.HTMLFormElement },
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
    else Reflect.deleteProperty(globalThis, name);
  }
});

function render(mode: 'off' | 'shadow' | 'active', source: 'none' | 'mail' | 'audit') {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ routines: messages }}>
        <RoutineGateField
          mode={mode}
          source={source}
          onModeChange={() => {}}
          onSourceChange={() => {}}
        />
      </NextIntlClientProvider>,
    ),
  );
  return document.querySelector('#root')!;
}

describe('RoutineGateField', () => {
  it('shows the shadow default and the explicit signal selector', () => {
    const view = render('shadow', 'none');
    assert.match(view.textContent ?? '', /Preflight signal/);
    assert.match(
      document.querySelector('#routine-gate-source')?.textContent ?? '',
      /No signal configured/,
    );
    assert.match(
      document.querySelector('#routine-gate-mode')?.textContent ?? '',
      /Shadow: record the result and run normally/,
    );
  });

  it('shows the active setting for the audit source', () => {
    render('active', 'audit');
    assert.match(
      document.querySelector('#routine-gate-source')?.textContent ?? '',
      /Open project tickets/,
    );
    assert.match(
      document.querySelector('#routine-gate-mode')?.textContent ?? '',
      /Active: skip only with owner approval/,
    );
  });
});
