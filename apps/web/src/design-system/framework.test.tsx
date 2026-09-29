import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import { Download, Inbox, Plus } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PageActions } from './layout/PageToolbar';
import { ActionMenu } from './components/ActionMenu';
import { NameList } from './components/NameList';
import { EmptyState } from './components/Section';
import { Page } from './layout/PageTemplate';

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
        messages={{ common: { more: 'More', close: 'Close', nameList: { more: '+{count} more' } } }}
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

// The UI framework's own rules (docs/ui-framework.md), tested on its building blocks.
describe('framework: a menu with one entry is a button (O36)', () => {
  it('PageActions shows a single rare action as a labelled button that runs it', () => {
    let exports = 0;
    render(
      <PageActions
        primary={{ id: 'new', label: 'New', icon: Plus, onClick: () => {} }}
        actions={[
          {
            id: 'export',
            label: 'Export',
            icon: Download,
            onClick: () => exports++,
            menuOnly: true,
          },
        ]}
      />,
    );
    assert.equal(document.querySelector('button[aria-label="More"]'), null);
    const button = document.querySelector('button[aria-label="Export"]')!;
    assert.match(button.textContent ?? '', /Export/);
    click(button);
    assert.equal(exports, 1);
  });

  it('ActionMenu with one item is a button, with several a "…" menu', () => {
    let runs = 0;
    render(
      <ActionMenu
        label="Actions"
        items={[{ id: 'a', label: 'Archive', onSelect: () => runs++ }]}
      />,
    );
    const single = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Archive',
    )!;
    click(single);
    assert.equal(runs, 1);
    render(
      <ActionMenu
        label="Actions"
        items={[
          { id: 'a', label: 'Archive', onSelect: () => {} },
          { id: 'b', label: 'Delete', onSelect: () => {}, danger: true },
        ]}
      />,
    );
    assert.ok(document.querySelector('button[aria-label="Actions"]'));
    assert.equal(
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Archive'),
      false,
    );
  });

  it('ActionMenu without items renders nothing', () => {
    render(<ActionMenu label="Actions" items={[]} />);
    assert.equal(document.querySelector('button'), null);
  });
});

describe('framework: NameList', () => {
  it('shows the first names and the rest on request', () => {
    render(<NameList names={['a', 'b', 'c', 'd', 'e']} max={3} />);
    assert.match(document.body.textContent ?? '', /a, b, c/);
    const more = document.querySelector('.ds-name-list-more')!;
    assert.equal(more.textContent, '+2 more');
    click(more);
    assert.match(document.body.textContent ?? '', /a, b, c, d, e/);
    assert.equal(document.querySelector('.ds-name-list-more'), null);
  });
});

describe('framework: EmptyState and Page', () => {
  it('EmptyState has a symbol, one sentence and the action', () => {
    render(
      <EmptyState icon={<Inbox />} action={<button type="button">Create</button>}>
        Nothing here yet.
      </EmptyState>,
    );
    const empty = document.querySelector('.ds-empty')!;
    assert.ok(empty.querySelector('.ds-empty-icon svg'));
    assert.equal(empty.querySelector('.ds-empty-text')?.textContent, 'Nothing here yet.');
    assert.equal(empty.querySelector('.ds-empty-action button')?.textContent, 'Create');
  });

  it('Page renders one body with its variant; a nested Page adds no second body', () => {
    render(
      <Page variant="fill" title="Outer">
        <Page title="Inner">
          <p id="content">x</p>
        </Page>
      </Page>,
    );
    assert.equal(document.querySelectorAll('.ds-page').length, 1);
    assert.equal(document.querySelectorAll('.ds-page-body').length, 1);
    assert.equal(document.querySelector('.ds-page')?.getAttribute('data-page'), 'fill');
    assert.ok(document.querySelector('.ds-page-nested #content'));
  });

  it('Page actions stand in the page without the Shell', () => {
    render(
      <Page actions={<button type="button">New</button>}>
        <p>x</p>
      </Page>,
    );
    assert.equal(document.querySelector('.ds-page-inline-actions button')?.textContent, 'New');
  });
});
