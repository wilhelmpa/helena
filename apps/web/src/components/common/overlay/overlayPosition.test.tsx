import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { overlayPosition } from './overlayPosition';

let dom: JSDOM;
let root: Root;
const saved = new Map<string, PropertyDescriptor | undefined>();

beforeEach(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLFormElement',
    'DocumentFragment',
    'DOMRect',
    'Element',
    'Node',
    'NodeFilter',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'MutationObserver',
    'getComputedStyle',
    'ResizeObserver',
    'IS_REACT_ACT_ENVIRONMENT',
  ]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
    HTMLFormElement: { configurable: true, value: dom.window.HTMLFormElement },
    DocumentFragment: { configurable: true, value: dom.window.DocumentFragment },
    DOMRect: { configurable: true, value: dom.window.DOMRect },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    NodeFilter: { configurable: true, value: dom.window.NodeFilter },
    Event: { configurable: true, value: dom.window.Event },
    CustomEvent: { configurable: true, value: dom.window.CustomEvent },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    MutationObserver: { configurable: true, value: dom.window.MutationObserver },
    getComputedStyle: { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) },
    ResizeObserver: {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
});

afterEach(async () => {
  act(() => root.unmount());
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('overlay position', () => {
  it('renders popover content in the body portal with shared collision clearance', async () => {
    const { Popover, PopoverContent, PopoverTrigger } = await import('@/components/ui/popover');
    const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } =
      await import('@/components/ui/dropdown-menu');
    await act(async () =>
      root.render(
        <>
          <Popover open>
            <PopoverTrigger>Öffnen</PopoverTrigger>
            <PopoverContent forceMount>Menü</PopoverContent>
          </Popover>
          <DropdownMenu open>
            <DropdownMenuTrigger>Optionen</DropdownMenuTrigger>
            <DropdownMenuContent forceMount>Einträge</DropdownMenuContent>
          </DropdownMenu>
        </>,
      ),
    );
    for (const selector of [
      '[data-slot="popover-content"]',
      '[data-slot="dropdown-menu-content"]',
    ]) {
      const content = document.querySelector(selector);
      assert.ok(content);
      assert.equal(document.querySelector('#root')?.contains(content), false);
      assert.equal(document.body.contains(content), true);
    }
    assert.deepEqual(overlayPosition, { avoidCollisions: true, collisionPadding: 8 });
  });

  it('mounts select, context menu and tooltip surfaces outside the page root', async () => {
    const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } =
      await import('@/components/ui/select');
    const { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } =
      await import('@/components/ui/context-menu');
    const { Tooltip, TooltipContent, TooltipTrigger } = await import('@/components/ui/tooltip');
    await act(async () =>
      root.render(
        <>
          <Select open value="one">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent forceMount>
              <SelectItem value="one">Eins</SelectItem>
            </SelectContent>
          </Select>
          <ContextMenu open>
            <ContextMenuTrigger>Bereich</ContextMenuTrigger>
            <ContextMenuContent forceMount>
              <ContextMenuItem>Aktion</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <Tooltip open>
            <TooltipTrigger>Hilfe</TooltipTrigger>
            <TooltipContent forceMount>Hinweis</TooltipContent>
          </Tooltip>
        </>,
      ),
    );
    for (const selector of [
      '[data-slot="select-content"]',
      '[data-slot="context-menu-content"]',
      '[data-slot="tooltip-content"]',
    ]) {
      const content = document.querySelector(selector);
      assert.ok(content, selector);
      assert.equal(document.querySelector('#root')?.contains(content), false, selector);
      assert.equal(document.body.contains(content), true, selector);
    }
  });
});
