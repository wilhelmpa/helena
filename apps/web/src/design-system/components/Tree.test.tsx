import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Tree, TreeAction, TreeItem, TreeMoreButton, TreeSearch } from './Tree';

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

const render = (node: React.ReactNode) => act(() => root.render(<Tree label="Test">{node}</Tree>));
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];

describe('a group of exactly one link (owner, O89)', () => {
  it('is that link: no arrow, no list, the row goes there', () => {
    render(
      <TreeItem id="automation" label="Automatisierung">
        <TreeItem label="Verlauf" href="/activity" />
      </TreeItem>,
    );
    assert.equal(rows().length, 1);
    assert.equal(rows()[0]!.textContent, 'Automatisierung');
    assert.equal(rows()[0]!.getAttribute('href'), '/activity');
    assert.equal(document.querySelector('.ds-tree-chevron'), null);
    assert.equal(rows()[0]!.getAttribute('aria-expanded'), null);
  });

  it('is marked when its one link is', () => {
    render(
      <TreeItem id="automation" label="Automatisierung">
        <TreeItem label="Verlauf" href="/activity" active />
      </TreeItem>,
    );
    assert.equal(rows()[0]!.getAttribute('aria-current'), 'page');
  });

  it('a link that is not alone, or a row with a page of its own, keeps its arrow', () => {
    render(
      <>
        <TreeItem id="two" label="Zwei">
          <TreeItem label="Eins" href="/one" />
          <TreeItem label="Zwei" href="/two" />
        </TreeItem>
        <TreeItem id="own" label="Eigene Seite" href="/own">
          <TreeItem label="Kind" href="/child" />
        </TreeItem>
      </>,
    );
    assert.equal(document.querySelectorAll('.ds-tree-chevron').length, 2);
  });

  it('a group that renders nothing has no arrow either', () => {
    render(
      <TreeItem id="empty" label="Leer">
        {false}
        {null}
      </TreeItem>,
    );
    assert.equal(document.querySelector('.ds-tree-chevron'), null);
  });
});

describe('row actions and the search field of an area (owner, O100)', () => {
  it('a hover-only action carries the class that leaves it out on a touch screen', () => {
    render(
      <TreeItem
        label="Gruppe"
        actions={
          <>
            <TreeAction label="Nur mit Maus" hoverOnly onClick={() => {}}>
              +
            </TreeAction>
            <TreeAction label="Immer" onClick={() => {}}>
              +
            </TreeAction>
          </>
        }
      />,
    );
    const only = document.querySelector('[aria-label="Nur mit Maus"]');
    const always = document.querySelector('[aria-label="Immer"]');
    assert.ok(only?.classList.contains('ds-tree-action-hover'));
    assert.ok(always?.classList.contains('ds-tree-action'));
    assert.ok(!always?.classList.contains('ds-tree-action-hover'));
  });

  it('the "…" button is a row action with its label', () => {
    render(<TreeItem label="Bereich" actions={<TreeMoreButton label="Optionen" />} />);
    const button = document.querySelector('button[aria-label="Optionen"]');
    assert.ok(button?.classList.contains('ds-tree-action'));
    assert.equal(button?.getAttribute('title'), 'Optionen');
  });

  it('a search field that opens on request takes the cursor and Escape closes it', () => {
    let closed = 0;
    render(
      <TreeSearch
        value=""
        onChange={() => {}}
        label="Suchen"
        focusOnOpen
        onEscape={() => closed++}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="search"]');
    assert.ok(input);
    assert.equal(document.activeElement, input);
    act(() => {
      input.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    assert.equal(closed, 1);
  });
});
