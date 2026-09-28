import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import { LayoutGrid, Upload } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PageActions } from './PageToolbar';

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
      <NextIntlClientProvider
        locale="en"
        messages={{ common: { more: 'More', close: 'Close' } }}
        timeZone="UTC"
      >
        <TooltipProvider>{node}</TooltipProvider>
      </NextIntlClientProvider>,
    ),
  );
}

const click = (element: Element) =>
  act(() => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));

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
  root = createRoot(document.querySelector('#root')!);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('PageActions', () => {
  // Regression (2026-09-24): the tooltip trigger's own onClick, spread over the
  // button, replaced the action's — icon actions with a tooltip did nothing.
  it('runs an icon action that sits in a tooltip', () => {
    let clicks = 0;
    render(
      <PageActions
        actions={[{ id: 'grid', label: 'Grid', icon: LayoutGrid, onClick: () => clicks++ }]}
      />,
    );
    click(document.querySelector('button[aria-label="Grid"]')!);
    assert.equal(clicks, 1);
  });

  it('runs the primary action', () => {
    let uploads = 0;
    render(
      <PageActions
        primary={{ id: 'upload', label: 'Upload', icon: Upload, onClick: () => uploads++ }}
      />,
    );
    click(document.querySelector('button[aria-label="Upload"]')!);
    assert.equal(uploads, 1);
  });

  it('does not run a disabled action', () => {
    let clicks = 0;
    render(
      <PageActions
        actions={[
          { id: 'grid', label: 'Grid', icon: LayoutGrid, disabled: true, onClick: () => clicks++ },
        ]}
      />,
    );
    click(document.querySelector('button[aria-label="Grid"]')!);
    assert.equal(clicks, 0);
  });
});
